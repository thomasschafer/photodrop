import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyJWT = vi.fn();
const mockGetGroup = vi.fn();
const mockGetGroupPhotoKeys = vi.fn();
const mockGetGroupPhotoCount = vi.fn();
const mockDeleteGroup = vi.fn();
const mockGetMembership = vi.fn();
const mockUpdateMemberImageProtection = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
  getGroupPhotoKeys: (...args: unknown[]) => mockGetGroupPhotoKeys(...args),
  getGroupPhotoCount: (...args: unknown[]) => mockGetGroupPhotoCount(...args),
  deleteGroup: (...args: unknown[]) => mockDeleteGroup(...args),
  getUserMemberships: vi.fn(),
  getGroupMembers: vi.fn(),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  updateMembershipRole: vi.fn(),
  deleteMembership: vi.fn(),
  updateUserName: vi.fn(),
  updateMemberImageProtection: (...args: unknown[]) => mockUpdateMemberImageProtection(...args),
}));

import groups from './groups';
import { errorHandler } from '../lib/errorHandler';

describe('DELETE /groups/:groupId', () => {
  let app: Hono;
  let mockR2Delete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembership.mockResolvedValue({
      user_id: 'owner-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
    });

    mockR2Delete = vi.fn().mockResolvedValue(undefined);

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = {
        JWT_SECRET: 'test-secret',
        DB: {},
        PHOTOS: { delete: mockR2Delete },
      };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.request('/groups/group-1', { method: 'DELETE' });

    expect(res.status).toBe(401);
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

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Only the group owner can perform this action');
  });

  it('returns 403 when groupId does not match user context', async () => {
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

    const res = await app.request('/groups/different-group', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Cannot delete a different group');
  });

  it('deletes group successfully when user is owner', async () => {
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
    mockGetGroupPhotoKeys.mockResolvedValue([
      { r2_key: 'photos/abc.jpg', thumbnail_r2_key: 'thumbnails/abc.jpg' },
    ]);
    mockDeleteGroup.mockResolvedValue(true);

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string };
    expect(json.message).toBe('Group deleted successfully');
    // Keys are deleted in a single batched R2 call, not one call per key.
    expect(mockR2Delete).toHaveBeenCalledTimes(1);
    expect(mockR2Delete).toHaveBeenCalledWith(['photos/abc.jpg', 'thumbnails/abc.jpg']);
    expect(mockDeleteGroup).toHaveBeenCalled();
  });

  it('deletes group with no photos', async () => {
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
    mockGetGroupPhotoKeys.mockResolvedValue([]);
    mockDeleteGroup.mockResolvedValue(true);

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    expect(mockR2Delete).not.toHaveBeenCalled();
    expect(mockDeleteGroup).toHaveBeenCalled();
  });

  it('succeeds even if R2 delete fails (DB first, R2 best-effort)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
    mockGetGroupPhotoKeys.mockResolvedValue([{ r2_key: 'photos/abc.jpg', thumbnail_r2_key: null }]);
    mockR2Delete.mockRejectedValue(new Error('R2 error'));
    mockDeleteGroup.mockResolvedValue(true);

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    // DB deletion succeeds, R2 failure is logged but doesn't block
    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; deletedFiles: number };
    expect(json.message).toBe('Group deleted successfully');
    expect(json.deletedFiles).toBe(0); // 1 total - 1 failed = 0
    expect(mockDeleteGroup).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('returns 500 when database deletion fails', async () => {
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
    mockGetGroupPhotoKeys.mockResolvedValue([]);
    mockDeleteGroup.mockResolvedValue(false);

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Failed to delete group from database');
  });
});

describe('GET /groups/:groupId/photo-count', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembership.mockResolvedValue({
      user_id: 'owner-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
    });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = {
        JWT_SECRET: 'test-secret',
        DB: {},
      };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.request('/groups/group-1/photo-count');

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not owner', async () => {
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

    const res = await app.request('/groups/group-1/photo-count', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(403);
  });

  it('returns photo count when user is owner', async () => {
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
    mockGetGroupPhotoCount.mockResolvedValue(42);

    const res = await app.request('/groups/group-1/photo-count', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { count: number };
    expect(json.count).toBe(42);
  });
});

describe('PATCH /groups/:groupId/members/:userId/image-protection', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembership.mockResolvedValue({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
    });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = {
        JWT_SECRET: 'test-secret',
        DB: {},
      };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when non-admin tries to update', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'member-user',
      groupId: 'group-1',
      role: 'member',
      type: 'access',
    });
    mockGetMembership.mockResolvedValue({
      user_id: 'member-user',
      group_id: 'group-1',
      role: 'member',
      joined_at: 1000,
      image_protection: 1,
    });

    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 when groupId does not match user context', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });

    const res = await app.request('/groups/different-group/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 404 when user is not a member', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    // First call: requireAdmin middleware checks the requesting user's membership
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
    });
    // Second call: endpoint checks the target user's membership
    mockGetMembership.mockResolvedValueOnce(null);

    const res = await app.request('/groups/group-1/members/nonexistent/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    // First: middleware auth check, Second: endpoint membership check
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
    });

    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: 'yes' }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('enabled must be a boolean');
  });

  it('enables image protection successfully', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
    });
    mockUpdateMemberImageProtection.mockResolvedValue(true);

    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string };
    expect(json.message).toBe('Image protection updated');
    expect(mockUpdateMemberImageProtection).toHaveBeenCalledWith({}, 'user-1', 'group-1', true);
  });

  it('disables image protection successfully', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
    });
    mockUpdateMemberImageProtection.mockResolvedValue(true);

    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(mockUpdateMemberImageProtection).toHaveBeenCalledWith({}, 'user-1', 'group-1', false);
  });

  it('returns 500 when database update fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
    });
    mockGetMembership.mockResolvedValueOnce({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
    });
    mockUpdateMemberImageProtection.mockResolvedValue(false);

    const res = await app.request('/groups/group-1/members/user-1/image-protection', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Failed to update image protection');

    consoleSpy.mockRestore();
  });
});
