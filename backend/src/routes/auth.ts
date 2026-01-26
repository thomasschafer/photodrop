import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import {
  createMagicLinkToken,
  getUserByEmail,
  getUserById,
  createUser,
  getGroup,
  createMembership,
  getMembership,
  getUserMemberships,
  markMagicLinkTokenUsed,
  type MembershipRole,
} from '../lib/db';
import { generateAccessToken, generateRefreshToken, verifyJWT } from '../lib/jwt';
import { verifyMagicLink } from '../lib/magic-links';
import { sendInviteEmail, sendLoginLinkEmail } from '../lib/email';
import { requireAuth, requireAdmin } from '../middleware/auth';
import type { Bindings } from '../types';

type Variables = {
  user: {
    id: string;
    groupId: string;
    role: MembershipRole;
  };
};

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Send invite email (admin only)
auth.post('/send-invite', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { email, role = 'member' } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    if (role !== 'admin' && role !== 'member') {
      return c.json({ error: 'Invalid role' }, 400);
    }

    // Get admin's group from JWT
    const user = c.get('user');
    if (!user || !user.groupId) {
      return c.json({ error: 'Invalid user context' }, 401);
    }

    // Check if user already exists in this group
    const existingUser = await getUserByEmail(c.env.DB, email);
    if (existingUser) {
      const existingMembership = await getMembership(c.env.DB, existingUser.id, user.groupId);
      if (existingMembership) {
        return c.json({ error: 'User is already a member of this group' }, 400);
      }
    }

    // Get group info for email
    const group = await getGroup(c.env.DB, user.groupId);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // Create magic link token
    const token = await createMagicLinkToken(c.env.DB, user.groupId, email, 'invite', role);

    // Generate magic link URL
    const magicLink = `${c.env.FRONTEND_URL}/auth/${token}`;

    await sendInviteEmail(c.env, email, existingUser?.name ?? null, group.name, magicLink);

    return c.json({
      message: existingUser ? 'User added to group' : 'Invite sent successfully',
      email,
      role,
      existingUser: !!existingUser,
    });
  } catch (error) {
    console.error('Error sending invite:', error);
    return c.json({ error: 'Failed to send invite' }, 500);
  }
});

// Send login link (public)
auth.post('/send-login-link', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    // Get user by email
    const user = await getUserByEmail(c.env.DB, email);
    if (!user) {
      // Don't reveal if user exists or not (security)
      return c.json({ message: 'If that email exists, a login link has been sent' });
    }

    // Get user's memberships to find a group for the magic link
    const memberships = await getUserMemberships(c.env.DB, user.id);

    // If user has no memberships, we still create a login token
    // but with a special "no group" marker - the frontend will show empty state
    const groupId = memberships.length > 0 ? memberships[0].group_id : 'no-group';

    // Create magic link token
    const token = await createMagicLinkToken(c.env.DB, groupId, email, 'login');

    // Generate magic link URL
    const magicLink = `${c.env.FRONTEND_URL}/auth/${token}`;

    // Send login email
    await sendLoginLinkEmail(c.env, email, user.name, magicLink);

    return c.json({ message: 'If that email exists, a login link has been sent' });
  } catch (error) {
    console.error('Error sending login link:', error);
    return c.json({ error: 'Failed to send login link' }, 500);
  }
});

// Verify magic link and issue JWT
auth.post('/verify-magic-link', async (c) => {
  try {
    const body = await c.req.json();
    const { token, name } = body;

    if (!token || typeof token !== 'string') {
      return c.json({ error: 'Token is required' }, 400);
    }

    // Verify token (don't consume yet - we may need to ask for name first)
    const result = await verifyMagicLink(c.env.DB, token);

    if (!result.valid || !result.token) {
      const errorMessages = {
        not_found: 'Invalid token',
        expired: 'Token has expired',
        already_used: 'Token has already been used',
        invalid: 'Invalid token',
      };
      const message = result.error ? errorMessages[result.error] : 'Invalid token';
      return c.json({ error: message }, 400);
    }

    const magicToken = result.token;
    let user;
    let memberships;

    if (magicToken.type === 'invite') {
      // Check if user already exists
      const existingUser = await getUserByEmail(c.env.DB, magicToken.email);

      if (existingUser) {
        // User exists, just create membership
        user = existingUser;
      } else {
        // New user - name must be provided in request
        const userName = name && typeof name === 'string' ? name.trim() : null;

        if (!userName) {
          // Don't consume token yet - user needs to provide name
          return c.json({
            needsName: true,
            email: magicToken.email,
            groupId: magicToken.group_id,
          });
        }

        // Create new user with name
        if (!magicToken.invite_role) {
          return c.json({ error: 'Invalid invite token' }, 400);
        }

        const userId = await createUser(c.env.DB, userName, magicToken.email);

        user = await getUserById(c.env.DB, userId);
      }

      if (!user) {
        return c.json({ error: 'Failed to create user' }, 500);
      }

      // Create membership for the group
      const existingMembership = await getMembership(c.env.DB, user.id, magicToken.group_id);
      if (!existingMembership) {
        await createMembership(
          c.env.DB,
          user.id,
          magicToken.group_id,
          magicToken.invite_role || 'member'
        );
      }

      // Get updated memberships
      memberships = await getUserMemberships(c.env.DB, user.id);

      // Mark token as used now that we've successfully processed the invite
      await markMagicLinkTokenUsed(c.env.DB, token);

      // For invites, always go directly to the invited group
      const invitedGroupMembership = memberships.find((m) => m.group_id === magicToken.group_id);
      if (!invitedGroupMembership) {
        return c.json({ error: 'Membership not found' }, 500);
      }

      const group = await getGroup(c.env.DB, magicToken.group_id);

      const accessToken = await generateAccessToken(
        user.id,
        magicToken.group_id,
        invitedGroupMembership.role,
        c.env.JWT_SECRET
      );
      const refreshToken = await generateRefreshToken(
        user.id,
        magicToken.group_id,
        invitedGroupMembership.role,
        c.env.JWT_SECRET
      );

      setCookie(c, 'refreshToken', refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      });

      return c.json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          profileColor: user.profile_color,
        },
        currentGroup: {
          id: magicToken.group_id,
          name: group?.name || invitedGroupMembership.group_name,
          role: invitedGroupMembership.role,
          ownerId: group?.owner_id || invitedGroupMembership.group_owner_id,
        },
        groups: memberships.map((m) => ({
          id: m.group_id,
          name: m.group_name,
          role: m.role,
          ownerId: m.group_owner_id,
        })),
        needsGroupSelection: false,
      });
    } else {
      // Login existing user
      user = await getUserByEmail(c.env.DB, magicToken.email);

      if (!user) {
        return c.json({ error: 'User not found' }, 400);
      }

      memberships = await getUserMemberships(c.env.DB, user.id);

      // Mark token as used now that we've successfully identified the user
      await markMagicLinkTokenUsed(c.env.DB, token);

      // Handle different membership scenarios for login
      if (memberships.length === 0) {
        return c.json({
          accessToken: null,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            profileColor: user.profile_color,
          },
          groups: [],
          needsGroupSelection: true,
        });
      }

      if (memberships.length === 1) {
        const membership = memberships[0];

        const accessToken = await generateAccessToken(
          user.id,
          membership.group_id,
          membership.role,
          c.env.JWT_SECRET
        );
        const refreshToken = await generateRefreshToken(
          user.id,
          membership.group_id,
          membership.role,
          c.env.JWT_SECRET
        );

        setCookie(c, 'refreshToken', refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
          maxAge: 30 * 24 * 60 * 60,
          path: '/',
        });

        return c.json({
          accessToken,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            profileColor: user.profile_color,
          },
          currentGroup: {
            id: membership.group_id,
            name: membership.group_name,
            role: membership.role,
            ownerId: membership.group_owner_id,
          },
          groups: memberships.map((m) => ({
            id: m.group_id,
            name: m.group_name,
            role: m.role,
            ownerId: m.group_owner_id,
          })),
          needsGroupSelection: false,
        });
      }

      // Multiple groups - return user info and groups, frontend shows picker
      return c.json({
        accessToken: null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          profileColor: user.profile_color,
        },
        groups: memberships.map((m) => ({
          id: m.group_id,
          name: m.group_name,
          role: m.role,
          ownerId: m.group_owner_id,
        })),
        needsGroupSelection: true,
      });
    }
  } catch (error) {
    console.error('Error verifying magic link:', error);
    return c.json({ error: 'Failed to verify magic link' }, 500);
  }
});

// Switch to a different group
auth.post('/switch-group', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { groupId } = body;

    if (!groupId || typeof groupId !== 'string') {
      return c.json({ error: 'Group ID is required' }, 400);
    }

    const currentUser = c.get('user');

    // Verify user has membership in the requested group
    const membership = await getMembership(c.env.DB, currentUser.id, groupId);
    if (!membership) {
      return c.json({ error: 'You are not a member of this group' }, 403);
    }

    // Get group info
    const group = await getGroup(c.env.DB, groupId);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // Get user info
    const user = await getUserById(c.env.DB, currentUser.id);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Generate new tokens for the new group
    const accessToken = await generateAccessToken(
      user.id,
      groupId,
      membership.role,
      c.env.JWT_SECRET
    );
    const refreshToken = await generateRefreshToken(
      user.id,
      groupId,
      membership.role,
      c.env.JWT_SECRET
    );

    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    // Get all memberships for the response
    const memberships = await getUserMemberships(c.env.DB, user.id);

    return c.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profileColor: user.profile_color,
      },
      currentGroup: {
        id: groupId,
        name: group.name,
        role: membership.role,
        ownerId: group.owner_id,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
      })),
    });
  } catch (error) {
    console.error('Error switching group:', error);
    return c.json({ error: 'Failed to switch group' }, 500);
  }
});

// Select initial group (for users with multiple groups after login)
auth.post('/select-group', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, groupId } = body;

    if (!userId || typeof userId !== 'string') {
      return c.json({ error: 'User ID is required' }, 400);
    }

    if (!groupId || typeof groupId !== 'string') {
      return c.json({ error: 'Group ID is required' }, 400);
    }

    // Get user
    const user = await getUserById(c.env.DB, userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Verify user has membership in the requested group
    const membership = await getMembership(c.env.DB, userId, groupId);
    if (!membership) {
      return c.json({ error: 'You are not a member of this group' }, 403);
    }

    // Get group info
    const group = await getGroup(c.env.DB, groupId);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    // Generate tokens
    const accessToken = await generateAccessToken(
      user.id,
      groupId,
      membership.role,
      c.env.JWT_SECRET
    );
    const refreshToken = await generateRefreshToken(
      user.id,
      groupId,
      membership.role,
      c.env.JWT_SECRET
    );

    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    // Get all memberships for the response
    const memberships = await getUserMemberships(c.env.DB, user.id);

    return c.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profileColor: user.profile_color,
      },
      currentGroup: {
        id: groupId,
        name: group.name,
        role: membership.role,
        ownerId: group.owner_id,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
      })),
    });
  } catch (error) {
    console.error('Error selecting group:', error);
    return c.json({ error: 'Failed to select group' }, 500);
  }
});

// Refresh access token
auth.post('/refresh', async (c) => {
  try {
    const refreshToken = c.req.header('Cookie')?.match(/refreshToken=([^;]+)/)?.[1];

    if (!refreshToken) {
      return c.json({ error: 'No refresh token provided' }, 401);
    }

    const payload = await verifyJWT(refreshToken, c.env.JWT_SECRET);

    if (!payload || payload.type !== 'refresh') {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    // Get user data
    const user = await getUserById(c.env.DB, payload.sub);

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    // Get membership for the group in the token
    const membership = await getMembership(c.env.DB, user.id, payload.groupId);

    // Get all memberships for the response
    const memberships = await getUserMemberships(c.env.DB, user.id);

    if (!membership) {
      // User is no longer a member of this group (e.g., group was deleted)
      // Return user info with their remaining groups so they can pick a new one
      return c.json({
        accessToken: null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          profileColor: user.profile_color,
        },
        currentGroup: null,
        groups: memberships.map((m) => ({
          id: m.group_id,
          name: m.group_name,
          role: m.role,
          ownerId: m.group_owner_id,
        })),
        needsGroupSelection: memberships.length > 0,
      });
    }

    // Get group info
    const group = await getGroup(c.env.DB, payload.groupId);

    // Generate new tokens with current role from membership
    const accessToken = await generateAccessToken(
      user.id,
      payload.groupId,
      membership.role,
      c.env.JWT_SECRET
    );

    const newRefreshToken = await generateRefreshToken(
      user.id,
      payload.groupId,
      membership.role,
      c.env.JWT_SECRET
    );

    setCookie(c, 'refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    return c.json({
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profileColor: user.profile_color,
      },
      currentGroup: {
        id: payload.groupId,
        name: group?.name || 'Unknown',
        role: membership.role,
        ownerId: group?.owner_id,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
      })),
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    return c.json({ error: 'Failed to refresh token' }, 500);
  }
});

// Logout
auth.post('/logout', async (c) => {
  // Clear refresh token cookie
  setCookie(c, 'refreshToken', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 0,
    path: '/',
  });

  return c.json({ message: 'Logged out successfully' });
});

export default auth;
