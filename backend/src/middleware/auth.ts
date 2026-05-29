import { Context, Next } from 'hono';
import { verifyJWT } from '../lib/jwt';
import { getMembership, getGroup, type MembershipRole } from '../lib/db';

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

  // Only accept tokens via Authorization header to prevent token leakage via URLs
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    c.status(401);
    c.res = c.json({ error: 'Unauthorized' });
    return false;
  }

  const token = authHeader.substring(7);

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

  // Access is revoked as soon as the membership disappears. Roles are also
  // refreshed from the database so JWT role claims cannot outlive role changes.
  const membership = await getMembership(c.env.DB, payload.sub, payload.groupId);
  if (!membership) {
    c.status(401);
    c.res = c.json({ error: 'Membership no longer exists' });
    return false;
  }

  // Attach user info to context (including group_id for isolation)
  c.set('user', {
    id: payload.sub,
    groupId: payload.groupId,
    role: membership.role,
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

  // authenticateUser refreshes this role from the database on every request.
  if (user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  await next();
}

export async function requireOwner(c: Context, next: Next) {
  const authenticated = await authenticateUser(c);
  if (!authenticated) {
    return;
  }

  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Owner access required' }, 403);
  }

  // Check if user is the group owner
  const group = await getGroup(c.env.DB, user.groupId);
  if (!group || group.owner_id !== user.id) {
    return c.json({ error: 'Only the group owner can perform this action' }, 403);
  }

  await next();
}
