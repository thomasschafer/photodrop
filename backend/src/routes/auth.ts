import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
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
  markMagicLinkTokenPending,
} from '../lib/db';
import {
  generateAccessToken,
  generateRefreshToken,
  generateGroupSelectionToken,
  verifyJWT,
  verifyGroupSelectionToken,
} from '../lib/jwt';
import { verifyMagicLink } from '../lib/magic-links';
import { sendInviteEmail, sendLoginLinkEmail } from '../lib/email';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createRateLimitMiddleware, rateLimitKeys, getClientIP } from '../middleware/rateLimit';
import { isValidEmail } from '../lib/validation';
import type { AppEnv } from '../types';

const auth = new Hono<AppEnv>();

// Rate limit configurations
const sendInviteRateLimit = createRateLimitMiddleware({
  maxRequests: 10,
  windowSeconds: 60 * 60, // 1 hour
  keyFn: rateLimitKeys.byUserId('invite'),
});

const sendLoginLinkRateLimit = createRateLimitMiddleware({
  maxRequests: 5,
  windowSeconds: 15 * 60, // 15 minutes
  keyFn: rateLimitKeys.byEmailFromBody('login'),
});

const verifyMagicLinkRateLimit = createRateLimitMiddleware({
  maxRequests: 10,
  windowSeconds: 15 * 60, // 15 minutes
  keyFn: (c) => `verify:${getClientIP(c)}`,
});

// Send invite email (admin only)
auth.post('/send-invite', requireAdmin, sendInviteRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { email: rawInput, role = 'member' } = body;
    const rawEmail = typeof rawInput === 'string' ? rawInput.trim() : rawInput;

    if (!rawEmail || typeof rawEmail !== 'string' || !isValidEmail(rawEmail)) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const email = rawEmail.toLowerCase();

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
auth.post('/send-login-link', sendLoginLinkRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { email: rawInput } = body;
    const rawEmail = typeof rawInput === 'string' ? rawInput.trim() : rawInput;

    if (!rawEmail || typeof rawEmail !== 'string' || !isValidEmail(rawEmail)) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const email = rawEmail.toLowerCase();

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
auth.post('/verify-magic-link', verifyMagicLinkRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { token, name } = body;

    if (!token || typeof token !== 'string') {
      return c.json({ error: 'Token is required' }, 400);
    }

    // Check if this is a name submission (user providing their name after needsName response)
    const isNameSubmission = !!(name && typeof name === 'string' && name.trim());

    // Verify token - allow pending state for name submissions since we set pending on first request
    const result = await verifyMagicLink(c.env.DB, token, isNameSubmission);

    if (!result.valid || !result.token) {
      const errorMessages: Record<string, string> = {
        not_found: 'Invalid token',
        expired: 'Token has expired',
        already_used: 'Token has already been used',
        pending: 'This link is already being processed. Please wait a moment and try again.',
        invalid: 'Invalid token',
      };
      const message = result.error ? errorMessages[result.error] : 'Invalid token';
      return c.json({ error: message }, 400);
    }

    const magicToken = result.token;

    // Mark token as pending to prevent concurrent use (race condition protection).
    // For name submissions, the token is already pending from the initial request.
    const canProceed = await markMagicLinkTokenPending(c.env.DB, token);
    if (!canProceed && !isNameSubmission) {
      return c.json({ error: 'This link is already being used. Please try again.' }, 400);
    }

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
          // (Token is already marked pending at the start of this handler)
          return c.json({
            needsName: true,
            email: magicToken.email,
            groupId: magicToken.group_id,
          });
        }

        // Validate name length
        if (userName.length > 100) {
          return c.json({ error: 'Name is too long (max 100 characters)' }, 400);
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
        sameSite: 'Lax',
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
          imageProtection: invitedGroupMembership.image_protection === 1,
        },
        groups: memberships.map((m) => ({
          id: m.group_id,
          name: m.group_name,
          role: m.role,
          ownerId: m.group_owner_id,
          imageProtection: m.image_protection === 1,
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
        // No groups - user has no memberships, nothing to select
        return c.json({
          accessToken: null,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            profileColor: user.profile_color,
          },
          groups: [],
          needsGroupSelection: false,
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
          sameSite: 'Lax',
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
            imageProtection: membership.image_protection === 1,
          },
          groups: memberships.map((m) => ({
            id: m.group_id,
            name: m.group_name,
            role: m.role,
            ownerId: m.group_owner_id,
            imageProtection: m.image_protection === 1,
          })),
          needsGroupSelection: false,
        });
      }

      // Multiple groups - return selection token and groups, frontend shows picker
      const selectionToken = await generateGroupSelectionToken(user.id, c.env.JWT_SECRET);
      return c.json({
        accessToken: null,
        selectionToken,
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
          imageProtection: m.image_protection === 1,
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
      sameSite: 'Lax',
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
        imageProtection: membership.image_protection === 1,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
        imageProtection: m.image_protection === 1,
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
    const { selectionToken, groupId } = body;

    if (!selectionToken || typeof selectionToken !== 'string') {
      return c.json({ error: 'Selection token is required' }, 400);
    }

    if (!groupId || typeof groupId !== 'string') {
      return c.json({ error: 'Group ID is required' }, 400);
    }

    // Verify the selection token and extract userId
    const tokenResult = await verifyGroupSelectionToken(selectionToken, c.env.JWT_SECRET);
    if (!tokenResult.valid) {
      return c.json({ error: 'Invalid or expired selection token' }, 401);
    }

    const userId = tokenResult.userId;

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
      sameSite: 'Lax',
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
        imageProtection: membership.image_protection === 1,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
        imageProtection: m.image_protection === 1,
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
    const refreshToken = getCookie(c, 'refreshToken');

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
      const selectionToken =
        memberships.length > 0
          ? await generateGroupSelectionToken(user.id, c.env.JWT_SECRET)
          : null;
      return c.json({
        accessToken: null,
        selectionToken,
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
          imageProtection: m.image_protection === 1,
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
      sameSite: 'Lax',
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
        imageProtection: membership.image_protection === 1,
      },
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
        imageProtection: m.image_protection === 1,
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
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  });

  return c.json({ message: 'Logged out successfully' });
});

export default auth;
