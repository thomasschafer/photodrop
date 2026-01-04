import { Context, Next } from 'hono';
import { verifyJWT, JWTPayload } from '../lib/jwt';
import { getUserById } from '../lib/db';

export type AuthContext = {
  Variables: {
    user: {
      id: string;
      role: 'admin' | 'viewer';
    };
  };
};

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  const secret = c.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET not configured');
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const payload = await verifyJWT(token, secret);

  if (!payload || payload.type !== 'access') {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Attach user info to context
  c.set('user', {
    id: payload.sub,
    role: payload.role,
  });

  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  await requireAuth(c, next);

  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  await next();
}
