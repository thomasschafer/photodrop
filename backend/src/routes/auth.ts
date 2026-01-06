import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { createMagicLinkToken, getUserByEmail, getUserById, createUser, getGroup } from '../lib/db';
import { generateAccessToken, generateRefreshToken, verifyJWT } from '../lib/jwt';
import { verifyAndConsumeToken } from '../lib/magic-links';
import { sendInviteEmail, sendLoginLinkEmail } from '../lib/email';
import { requireAdmin } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  FRONTEND_URL: string;
};

const auth = new Hono<{ Bindings: Bindings }>();

// Send invite email (admin only)
auth.post('/send-invite', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, role = 'member' } = body;

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'Name is required' }, 400);
    }

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

    // Check if user already exists
    const existingUser = await getUserByEmail(c.env.DB, email);
    if (existingUser) {
      return c.json({ error: 'User with this email already exists' }, 400);
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

    // Send invite email
    await sendInviteEmail(email, name, group.name, magicLink);

    return c.json({
      message: 'Invite sent successfully',
      email,
      name,
      role,
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

    // Create magic link token
    const token = await createMagicLinkToken(c.env.DB, user.group_id, email, 'login');

    // Generate magic link URL
    const magicLink = `${c.env.FRONTEND_URL}/auth/${token}`;

    // Send login email
    await sendLoginLinkEmail(email, user.name, magicLink);

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
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return c.json({ error: 'Token is required' }, 400);
    }

    // Verify and consume token
    const result = await verifyAndConsumeToken(c.env.DB, token);

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

    if (magicToken.type === 'invite') {
      // Create new user
      if (!magicToken.invite_role) {
        return c.json({ error: 'Invalid invite token' }, 400);
      }

      const userId = await createUser(
        c.env.DB,
        magicToken.group_id,
        magicToken.email.split('@')[0], // Use email prefix as default name (user can update later)
        magicToken.email,
        magicToken.invite_role
      );

      user = await getUserById(c.env.DB, userId);
    } else {
      // Login existing user
      user = await getUserByEmail(c.env.DB, magicToken.email);
    }

    if (!user) {
      return c.json({ error: 'User not found' }, 400);
    }

    // Ensure user belongs to the token's group (security check)
    if (user.group_id !== magicToken.group_id) {
      return c.json({ error: 'Invalid token' }, 400);
    }

    // Generate JWT tokens
    const accessToken = await generateAccessToken(
      user.id,
      user.group_id,
      user.role,
      c.env.JWT_SECRET
    );
    const refreshToken = await generateRefreshToken(
      user.id,
      user.group_id,
      user.role,
      c.env.JWT_SECRET
    );

    // Set refresh token as httpOnly cookie
    setCookie(c, 'refreshToken', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return c.json({
      accessToken,
      user: {
        id: user.id,
        groupId: user.group_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Error verifying magic link:', error);
    return c.json({ error: 'Failed to verify magic link' }, 500);
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

    // Get latest user data to ensure role is up to date
    const user = await getUserById(c.env.DB, payload.sub);

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    // Ensure user's group matches token's group (security check)
    if (user.group_id !== payload.groupId) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Generate new access token with current role
    const accessToken = await generateAccessToken(
      user.id,
      user.group_id,
      user.role,
      c.env.JWT_SECRET
    );

    // Generate new refresh token (token rotation)
    const newRefreshToken = await generateRefreshToken(
      user.id,
      user.group_id,
      user.role,
      c.env.JWT_SECRET
    );

    // Update refresh token cookie
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
        groupId: user.group_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
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
