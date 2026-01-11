import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyJWT = vi.fn();
const mockGetMembership = vi.fn();
const mockGetGroup = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
}));

import { requireOwner } from './auth';

describe('requireOwner middleware', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', DB: {} };
      await next();
    });

    app.delete('/test', requireOwner, (c) => {
      return c.json({ success: true });
    });
  });

  it('returns 401 when no authorization header', async () => {
    const res = await app.request('/test', { method: 'DELETE' });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when JWT is invalid', async () => {
    mockVerifyJWT.mockResolvedValue(null);

    const res = await app.request('/test', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer invalid-token' },
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Invalid or expired token');
  });

  it('returns 403 when user is admin but not owner', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetGroup.mockResolvedValue({
      id: 'group-1',
      name: 'Test Group',
      owner_id: 'different-owner',
      created_at: 1000,
    });

    const res = await app.request('/test', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Only the group owner can perform this action');
  });

  it('returns 403 when user is member (not admin or owner)', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'member-user',
      groupId: 'group-1',
      role: 'member',
      type: 'access',
    });
    mockGetGroup.mockResolvedValue({
      id: 'group-1',
      name: 'Test Group',
      owner_id: 'owner-user',
      created_at: 1000,
    });

    const res = await app.request('/test', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Only the group owner can perform this action');
  });

  it('allows request when user is owner', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'owner-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetGroup.mockResolvedValue({
      id: 'group-1',
      name: 'Test Group',
      owner_id: 'owner-user',
      created_at: 1000,
    });

    const res = await app.request('/test', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('returns 403 when group does not exist', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'user-1',
      groupId: 'nonexistent-group',
      role: 'admin',
      type: 'access',
    });
    mockGetGroup.mockResolvedValue(null);

    const res = await app.request('/test', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Only the group owner can perform this action');
  });
});
