import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { NAME_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetGroup = vi.fn();
const mockGetGroupPhotoKeys = vi.fn();
const mockGetGroupPhotoCount = vi.fn();
const mockDeleteGroup = vi.fn();
const mockGetMembership = vi.fn();
const mockUpdateMemberImageProtection = vi.fn();
const mockUpdateMembershipRole = vi.fn();
const mockUpdateMemberDisplayName = vi.fn();
const mockGetMemberNames = vi.fn();
// No route here may call this: users.name is tenant-wide, so an admin writing
// it renames the person in every group they belong to. It stays mocked so the
// member routes can assert they never reach for it.
const mockUpdateUserName = vi.fn();
const mockGetGroupMembers = vi.fn();
const mockDeleteMembership = vi.fn();
const mockDeleteAllUserPushSubscriptionsForGroup = vi.fn();
const mockDeleteAllUserDeviceTokensForGroup = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
  getGroupPhotoKeys: (...args: unknown[]) => mockGetGroupPhotoKeys(...args),
  getGroupPhotoCount: (...args: unknown[]) => mockGetGroupPhotoCount(...args),
  deleteGroup: (...args: unknown[]) => mockDeleteGroup(...args),
  getUserMemberships: vi.fn(),
  getGroupMembers: (...args: unknown[]) => mockGetGroupMembers(...args),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  updateMembershipRole: (...args: unknown[]) => mockUpdateMembershipRole(...args),
  deleteMembership: (...args: unknown[]) => mockDeleteMembership(...args),
  updateMemberDisplayName: (...args: unknown[]) => mockUpdateMemberDisplayName(...args),
  getMemberNames: (...args: unknown[]) => mockGetMemberNames(...args),
  updateUserName: (...args: unknown[]) => mockUpdateUserName(...args),
  updateMemberImageProtection: (...args: unknown[]) => mockUpdateMemberImageProtection(...args),
  deleteAllUserPushSubscriptionsForGroup: (...args: unknown[]) =>
    mockDeleteAllUserPushSubscriptionsForGroup(...args),
  deleteAllUserDeviceTokensForGroup: (...args: unknown[]) =>
    mockDeleteAllUserDeviceTokensForGroup(...args),
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

describe('PATCH /groups/:groupId/members/:userId', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    // First call: requireAdmin checks the caller. Second: the target member.
    mockGetMembership.mockResolvedValue({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
    });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', DB: {} };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  function patchMember(body: unknown) {
    return app.request('/groups/group-1/members/user-1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects a body that would change nothing', async () => {
    const res = await patchMember({});

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Provide a role to update');
    expect(mockUpdateMembershipRole).not.toHaveBeenCalled();
  });

  it('updates the role when one is provided', async () => {
    mockUpdateMembershipRole.mockResolvedValue({ success: true });

    const res = await patchMember({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(mockUpdateMembershipRole).toHaveBeenCalledWith({}, 'user-1', 'group-1', 'admin');
  });

  it('refuses to rename the member: a name here would rewrite it in every group', async () => {
    const res = await patchMember({ name: 'Renamed' });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Provide a role to update');
    expect(mockUpdateMembershipRole).not.toHaveBeenCalled();
    expect(mockUpdateUserName).not.toHaveBeenCalled();
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('ignores a name smuggled in alongside a role', async () => {
    mockUpdateMembershipRole.mockResolvedValue({ success: true });

    const res = await patchMember({ role: 'member', name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(mockUpdateMembershipRole).toHaveBeenCalledWith({}, 'user-1', 'group-1', 'member');
    // Neither the canonical name nor a display name may be written from here.
    expect(mockUpdateUserName).not.toHaveBeenCalled();
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });
});

describe('GET /groups/:groupId/members', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetMembership.mockResolvedValue({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
      display_name: null,
    });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', DB: {} };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  it('reports the resolved name to show, the raw override, and the canonical name', async () => {
    mockGetGroupMembers.mockResolvedValue({
      ownerId: 'admin-user',
      members: [
        {
          user_id: 'user-1',
          group_id: 'group-1',
          role: 'member',
          joined_at: 1000,
          image_protection: 1,
          display_name: 'Mum',
          user_name: 'Mum',
          canonical_name: 'Jane Doe',
          user_email: 'jane@example.com',
          user_profile_color: 'teal',
        },
        {
          user_id: 'user-2',
          group_id: 'group-1',
          role: 'member',
          joined_at: 2000,
          image_protection: 1,
          display_name: null,
          user_name: 'Bob Smith',
          canonical_name: 'Bob Smith',
          user_email: 'bob@example.com',
          user_profile_color: 'sage',
        },
      ],
    });

    const res = await app.request('/groups/group-1/members', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      members: Array<{
        userId: string;
        name: string;
        displayName: string | null;
        canonicalName: string;
      }>;
    };
    // An admin UI needs all three: what to render, whether it is an override it
    // can offer to reset, and whose name that override stands in for.
    expect(json.members[0]).toMatchObject({
      userId: 'user-1',
      name: 'Mum',
      displayName: 'Mum',
      canonicalName: 'Jane Doe',
    });
    expect(json.members[1]).toMatchObject({
      userId: 'user-2',
      name: 'Bob Smith',
      displayName: null,
      canonicalName: 'Bob Smith',
    });
  });
});

describe('PATCH /groups/:groupId/members/:userId/display-name', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMemberDisplayName.mockResolvedValue(true);
    mockGetMemberNames.mockResolvedValue({ resolvedName: 'Mum', canonicalName: 'Jane Doe' });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', DB: {} };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  function authenticateAs(userId: string, role: 'admin' | 'member') {
    mockVerifyJWT.mockResolvedValue({ sub: userId, groupId: 'group-1', role, type: 'access' });
    // First call: the auth middleware checks the caller's membership. Second:
    // the route checks the target's.
    mockGetMembership.mockResolvedValueOnce({
      user_id: userId,
      group_id: 'group-1',
      role,
      joined_at: 1000,
      image_protection: 1,
      display_name: null,
    });
    mockGetMembership.mockResolvedValue({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
      joined_at: 1000,
      image_protection: 1,
      display_name: null,
    });
  }

  function patchDisplayName(targetUserId: string, body: unknown, groupId = 'group-1') {
    return app.request(`/groups/${groupId}/members/${targetUserId}/display-name`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 when not authenticated', async () => {
    const res = await app.request('/groups/group-1/members/user-1/display-name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Mum' }),
    });

    expect(res.status).toBe(401);
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('returns 403 when groupId does not match the caller context', async () => {
    authenticateAs('admin-user', 'admin');

    const res = await patchDisplayName('user-1', { displayName: 'Mum' }, 'different-group');

    expect(res.status).toBe(403);
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('lets an admin set an override for another member', async () => {
    authenticateAs('admin-user', 'admin');

    const res = await patchDisplayName('user-1', { displayName: 'Mum' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      userId: string;
      displayName: string;
      name: string;
      canonicalName: string;
    };
    // The canonical name comes back too, so the admin's list row stays complete
    // (and correct if the member renamed themselves) without a refetch.
    expect(json).toMatchObject({
      userId: 'user-1',
      displayName: 'Mum',
      name: 'Mum',
      canonicalName: 'Jane Doe',
    });
    expect(mockUpdateMemberDisplayName).toHaveBeenCalledWith({}, 'user-1', 'group-1', 'Mum');
  });

  it('lets a member set their own override', async () => {
    authenticateAs('user-1', 'member');

    const res = await patchDisplayName('user-1', { displayName: 'Mum' });

    expect(res.status).toBe(200);
    expect(mockUpdateMemberDisplayName).toHaveBeenCalledWith({}, 'user-1', 'group-1', 'Mum');
  });

  it("returns 403 when a member targets someone else's display name", async () => {
    authenticateAs('user-2', 'member');

    const res = await patchDisplayName('user-1', { displayName: 'Mum' });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('You can only change your own display name');
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('clears the override on an explicit null, restoring the canonical name', async () => {
    authenticateAs('admin-user', 'admin');
    mockGetMemberNames.mockResolvedValue({ resolvedName: 'Jane Doe', canonicalName: 'Jane Doe' });

    const res = await patchDisplayName('user-1', { displayName: null });

    expect(res.status).toBe(200);
    expect(mockUpdateMemberDisplayName).toHaveBeenCalledWith({}, 'user-1', 'group-1', null);
    const json = (await res.json()) as {
      displayName: string | null;
      name: string;
      canonicalName: string;
    };
    expect(json).toMatchObject({ displayName: null, name: 'Jane Doe', canonicalName: 'Jane Doe' });
  });

  it('rejects a body with no displayName rather than reading it as a clear', async () => {
    authenticateAs('admin-user', 'admin');

    const res = await patchDisplayName('user-1', {});

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(
      'displayName must be a non-empty string, or null to clear the override'
    );
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('rejects a blank display name', async () => {
    authenticateAs('admin-user', 'admin');

    const res = await patchDisplayName('user-1', { displayName: '   ' });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Name cannot be empty');
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('rejects a display name over the shared name limit', async () => {
    authenticateAs('admin-user', 'admin');

    const res = await patchDisplayName('user-1', { displayName: 'a'.repeat(NAME_MAX_LENGTH + 1) });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(`Name must be ${NAME_MAX_LENGTH} characters or less`);
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('returns 404 when the target is not a member of the group', async () => {
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
    mockGetMembership.mockResolvedValueOnce(null);

    const res = await patchDisplayName('nonexistent', { displayName: 'Mum' });

    expect(res.status).toBe(404);
    expect(mockUpdateMemberDisplayName).not.toHaveBeenCalled();
  });

  it('returns 500 rather than a nameless response when the names cannot be re-read', async () => {
    authenticateAs('admin-user', 'admin');
    mockGetMemberNames.mockResolvedValue(null);

    const res = await patchDisplayName('user-1', { displayName: 'Mum' });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Failed to resolve the member name after the update');
  });

  it('returns 500 when the update changes no row', async () => {
    authenticateAs('admin-user', 'admin');
    mockUpdateMemberDisplayName.mockResolvedValue(false);

    const res = await patchDisplayName('user-1', { displayName: 'Mum' });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Failed to update display name');
  });
});

describe('DELETE /groups/:groupId/members/:userId', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyJWT.mockResolvedValue({
      sub: 'admin-user',
      groupId: 'group-1',
      role: 'admin',
      type: 'access',
    });
    mockGetMembership.mockResolvedValue({
      user_id: 'admin-user',
      group_id: 'group-1',
      role: 'admin',
      joined_at: 1000,
      image_protection: 1,
    });
    mockDeleteMembership.mockResolvedValue({ success: true });
    mockDeleteAllUserPushSubscriptionsForGroup.mockResolvedValue(undefined);
    mockDeleteAllUserDeviceTokensForGroup.mockResolvedValue(undefined);

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', DB: {} };
      await next();
    });
    app.route('/groups', groups);
    app.onError(errorHandler);
  });

  it('revokes both web push and native device notifications for the removed member', async () => {
    const res = await app.request('/groups/group-1/members/user-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    expect(mockDeleteMembership).toHaveBeenCalledWith({}, 'user-1', 'group-1');
    expect(mockDeleteAllUserPushSubscriptionsForGroup).toHaveBeenCalledWith(
      {},
      'user-1',
      'group-1'
    );
    // Without this, the expelled member's device keeps receiving the group's
    // photo notifications, caption text included.
    expect(mockDeleteAllUserDeviceTokensForGroup).toHaveBeenCalledWith({}, 'user-1', 'group-1');
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
