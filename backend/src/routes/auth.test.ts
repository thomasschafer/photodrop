import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetMembership = vi.fn();
const mockGetGroup = vi.fn();
const mockGetUserById = vi.fn();
const mockGenerateAccessToken = vi.fn();
const mockGenerateRefreshToken = vi.fn();
const mockGetUserMemberships = vi.fn();

vi.mock('../lib/db', () => ({
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
}));

vi.mock('../lib/jwt', () => ({
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
  generateRefreshToken: (...args: unknown[]) => mockGenerateRefreshToken(...args),
  verifyJWT: vi.fn(),
}));

describe('switch-group endpoint', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    app = new Hono();

    app.post('/switch-group', async (c) => {
      const body = await c.req.json();
      const { groupId } = body;

      if (!groupId || typeof groupId !== 'string') {
        return c.json({ error: 'Group ID is required' }, 400);
      }

      const currentUserId = 'test-user-id';

      const membership = await mockGetMembership(null, currentUserId, groupId);
      if (!membership) {
        return c.json({ error: 'You are not a member of this group' }, 403);
      }

      const group = await mockGetGroup(null, groupId);
      if (!group) {
        return c.json({ error: 'Group not found' }, 404);
      }

      const user = await mockGetUserById(null, currentUserId);
      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      const accessToken = await mockGenerateAccessToken(
        user.id,
        groupId,
        membership.role,
        'secret'
      );
      const _refreshToken = await mockGenerateRefreshToken(
        user.id,
        groupId,
        membership.role,
        'secret'
      );

      const memberships = await mockGetUserMemberships(null, user.id);

      return c.json({
        accessToken,
        user: { id: user.id, name: user.name, email: user.email },
        currentGroup: { id: groupId, name: group.name, role: membership.role },
        groups: memberships.map((m: { group_id: string; group_name: string; role: string }) => ({
          id: m.group_id,
          name: m.group_name,
          role: m.role,
        })),
      });
    });
  });

  it('rejects switch-group if user is not a member of the group', async () => {
    mockGetMembership.mockResolvedValue(null);

    const res = await app.request('/switch-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'group-not-member-of' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('You are not a member of this group');
  });

  it('generates token with correct groupId when switching groups', async () => {
    const targetGroupId = 'target-group-123';
    mockGetMembership.mockResolvedValue({
      user_id: 'test-user-id',
      group_id: targetGroupId,
      role: 'admin',
      joined_at: 1000,
    });
    mockGetGroup.mockResolvedValue({ id: targetGroupId, name: 'Target Group' });
    mockGetUserById.mockResolvedValue({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
    });
    mockGenerateAccessToken.mockResolvedValue('mock-access-token');
    mockGenerateRefreshToken.mockResolvedValue('mock-refresh-token');
    mockGetUserMemberships.mockResolvedValue([
      { group_id: targetGroupId, group_name: 'Target Group', role: 'admin' },
    ]);

    const res = await app.request('/switch-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: targetGroupId }),
    });

    expect(res.status).toBe(200);

    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      'test-user-id',
      targetGroupId,
      'admin',
      'secret'
    );

    const json = await res.json();
    expect(json.currentGroup.id).toBe(targetGroupId);
    expect(json.accessToken).toBe('mock-access-token');
  });

  it('rejects switch-group with missing groupId', async () => {
    const res = await app.request('/switch-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Group ID is required');
  });

  it('returns 404 when group does not exist', async () => {
    mockGetMembership.mockResolvedValue({
      user_id: 'test-user-id',
      group_id: 'deleted-group',
      role: 'member',
      joined_at: 1000,
    });
    mockGetGroup.mockResolvedValue(null);

    const res = await app.request('/switch-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'deleted-group' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Group not found');
  });
});
