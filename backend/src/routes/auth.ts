import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { createInvite, acceptInvite as dbAcceptInvite, getUserById } from '../lib/db';
import { generateAccessToken, generateRefreshToken, verifyJWT } from '../lib/jwt';
import { requireAdmin } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
};

const auth = new Hono<{ Bindings: Bindings }>();

// Create invite (admin only)
auth.post('/create-invite', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { name, phone, role = 'viewer' } = body;

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'Name is required' }, 400);
    }

    if (role !== 'admin' && role !== 'viewer') {
      return c.json({ error: 'Invalid role' }, 400);
    }

    const { userId, inviteToken } = await createInvite(
      c.env.DB,
      name,
      role,
      phone
    );

    // Generate invite URL (frontend will be at the same domain or specified in env)
    const inviteUrl = `${new URL(c.req.url).origin}/invite/${inviteToken}`;

    return c.json({
      userId,
      inviteToken,
      inviteUrl,
      name,
      role,
    });
  } catch (error) {
    console.error('Error creating invite:', error);
    return c.json({ error: 'Failed to create invite' }, 500);
  }
});

// Accept invite
auth.post('/accept-invite', async (c) => {
  try {
    const body = await c.req.json();
    const { inviteToken } = body;

    if (!inviteToken || typeof inviteToken !== 'string') {
      return c.json({ error: 'Invite token is required' }, 400);
    }

    const user = await dbAcceptInvite(c.env.DB, inviteToken);

    if (!user) {
      return c.json({ error: 'Invalid or already used invite token' }, 400);
    }

    // Generate tokens
    const accessToken = await generateAccessToken(
      user.id,
      user.role,
      c.env.JWT_SECRET
    );
    const refreshToken = await generateRefreshToken(
      user.id,
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
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Error accepting invite:', error);
    return c.json({ error: 'Failed to accept invite' }, 500);
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

    if (!user || !user.invite_accepted_at) {
      return c.json({ error: 'User not found' }, 401);
    }

    // Generate new access token with current role
    const accessToken = await generateAccessToken(
      user.id,
      user.role,
      c.env.JWT_SECRET
    );

    // Generate new refresh token (token rotation)
    const newRefreshToken = await generateRefreshToken(
      user.id,
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
        name: user.name,
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
