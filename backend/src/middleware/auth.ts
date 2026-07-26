import { Context, Next } from 'hono';
import { verifyJWT } from '../lib/jwt';
import { getMembership, getGroup, type MembershipRole } from '../lib/db';
import { UnauthorizedError, ForbiddenError, InternalServerError } from '../lib/http';

export type AuthContext = {
  Variables: {
    user: {
      id: string;
      groupId: string;
      role: MembershipRole;
    };
  };
};

async function authenticateUser(c: Context): Promise<void> {
  const authHeader = c.req.header('Authorization');

  // Only accept tokens via Authorization header to prevent token leakage via URLs
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Unauthorized');
  }

  const token = authHeader.substring(7);

  if (!token) {
    throw new UnauthorizedError('Unauthorized');
  }

  const secret = c.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET not configured');
    throw new InternalServerError('Server configuration error');
  }

  const payload = await verifyJWT(token, secret);

  if (!payload || payload.type !== 'access') {
    throw new UnauthorizedError('Invalid or expired token');
  }

  // Access is revoked as soon as the membership disappears. Roles are also
  // refreshed from the database so JWT role claims cannot outlive role changes.
  const membership = await getMembership(c.env.DB, payload.sub, payload.groupId);
  if (!membership) {
    throw new UnauthorizedError('Membership no longer exists');
  }

  // Attach user info to context (including group_id for isolation)
  c.set('user', {
    id: payload.sub,
    groupId: payload.groupId,
    role: membership.role,
  });
}

export async function requireAuth(c: Context, next: Next) {
  await authenticateUser(c);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  await authenticateUser(c);

  // authenticateUser refreshes this role from the database on every request.
  if (c.get('user').role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }

  await next();
}

export async function requireOwner(c: Context, next: Next) {
  await authenticateUser(c);

  const user = c.get('user');
  const group = await getGroup(c.env.DB, user.groupId);
  if (!group || group.owner_id !== user.id) {
    throw new ForbiddenError('Only the group owner can perform this action');
  }

  await next();
}
