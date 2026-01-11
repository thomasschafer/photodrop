import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyJWT = vi.fn();
const mockGetGroup = vi.fn();
const mockGetGroupPhotoKeys = vi.fn();
const mockGetGroupPhotoCount = vi.fn();
const mockDeleteGroup = vi.fn();

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
  getMembership: vi.fn(),
  updateMembershipRole: vi.fn(),
  deleteMembership: vi.fn(),
  updateUserName: vi.fn(),
}));

import groups from './groups';

describe('DELETE /groups/:groupId', () => {
  let app: Hono;
  let mockR2Delete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

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
    expect(mockR2Delete).toHaveBeenCalledWith('photos/abc.jpg');
    expect(mockR2Delete).toHaveBeenCalledWith('thumbnails/abc.jpg');
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

  it('fails deletion if R2 delete fails', async () => {
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
      { r2_key: 'photos/abc.jpg', thumbnail_r2_key: null },
    ]);
    mockR2Delete.mockRejectedValue(new Error('R2 error'));
    mockDeleteGroup.mockResolvedValue(true);

    const res = await app.request('/groups/group-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; details: { failedCount: number } };
    expect(json.error).toBe('Failed to delete some photos from storage');
    expect(json.details.failedCount).toBe(1);
    expect(mockDeleteGroup).not.toHaveBeenCalled();
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

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = {
        JWT_SECRET: 'test-secret',
        DB: {},
      };
      await next();
    });
    app.route('/groups', groups);
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
