import { Context, Next } from 'hono';
import { verifyJWT } from '../lib/jwt';
import { getMembership, type MembershipRole } from '../lib/db';

export type AuthContext = {
  Variables: {
    user: {
      id: string;
      groupId: string;
      role: MembershipRole;
    };
  };
};

async function authenticateUser(c: Context): Promise<boolean> {
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');

  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    c.status(401);
    c.res = c.json({ error: 'Unauthorized' });
    return false;
  }
  const secret = c.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET not configured');
    c.status(500);
    c.res = c.json({ error: 'Server configuration error' });
    return false;
  }

  const payload = await verifyJWT(token, secret);

  if (!payload || payload.type !== 'access') {
    c.status(401);
    c.res = c.json({ error: 'Invalid or expired token' });
    return false;
  }

  // Attach user info to context (including group_id for isolation)
  c.set('user', {
    id: payload.sub,
    groupId: payload.groupId,
    role: payload.role,
  });

  return true;
}

export async function requireAuth(c: Context, next: Next) {
  const authenticated = await authenticateUser(c);
  if (!authenticated) {
    return;
  }
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const authenticated = await authenticateUser(c);
  if (!authenticated) {
    return;
  }

  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Check actual role from database (not JWT) to handle role changes immediately
  const membership = await getMembership(c.env.DB, user.id, user.groupId);
  if (!membership || membership.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Update context with current role from DB
  c.set('user', { ...user, role: membership.role });

  await next();
}
