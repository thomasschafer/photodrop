import { describe, it, expect, vi } from 'vitest';
import {
  getUserMemberships,
  getMembership,
  createMembership,
  deleteMembership,
  updateMembershipRole,
  updateMemberImageProtection,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
  createPushSubscription,
  getUserPushSubscriptionsForGroup,
  getGroupPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionForGroup,
  deleteAllUserPushSubscriptionsForGroup,
  createDeviceToken,
  getDeviceToken,
  getGroupDeviceTokens,
  deleteDeviceToken,
  deleteDeviceTokenByToken,
  countUserDeviceTokensSince,
  createComment,
  getCommentsByPhotoId,
  getComment,
  deleteComment,
  getPhotoReactionsWithUsers,
  listPhotosWithCounts,
  createUser,
  updateUserProfileColor,
} from './db';
import {
  getRandomProfileColor,
  PROFILE_COLORS,
  type ProfileColor,
} from '@photodrop/common/profileColors';

function createMockDb(results: unknown[] = [], error?: Error) {
  const mockFirst = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve(results[0] ?? null);
  });

  const mockAll = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve({ results, success: true });
  });

  const mockRun = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve({ success: true, meta: { changes: 1 } });
  });

  const mockBind = vi.fn().mockReturnValue({
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });

  const mockPrepare = vi.fn().mockReturnValue({
    bind: mockBind,
  });

  return {
    prepare: mockPrepare,
    _mocks: { mockPrepare, mockBind, mockFirst, mockAll, mockRun },
  } as unknown as D1Database & {
    _mocks: {
      mockPrepare: ReturnType<typeof vi.fn>;
      mockBind: ReturnType<typeof vi.fn>;
      mockFirst: ReturnType<typeof vi.fn>;
      mockAll: ReturnType<typeof vi.fn>;
      mockRun: ReturnType<typeof vi.fn>;
    };
  };
}

// Creates a mock that returns different results for sequential first() calls
function createSequentialMockDb(firstResults: (unknown | null)[], error?: Error) {
  let callIndex = 0;

  const mockFirst = vi.fn().mockImplementation(() => {
    if (error) throw error;
    const result = firstResults[callIndex] ?? null;
    callIndex++;
    return Promise.resolve(result);
  });

  const mockAll = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve({ results: [], success: true });
  });

  const mockRun = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve({ success: true, meta: { changes: 1 } });
  });

  const mockBind = vi.fn().mockReturnValue({
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });

  const mockPrepare = vi.fn().mockReturnValue({
    bind: mockBind,
  });

  return {
    prepare: mockPrepare,
    _mocks: { mockPrepare, mockBind, mockFirst, mockAll, mockRun },
  } as unknown as D1Database & {
    _mocks: {
      mockPrepare: ReturnType<typeof vi.fn>;
      mockBind: ReturnType<typeof vi.fn>;
      mockFirst: ReturnType<typeof vi.fn>;
      mockAll: ReturnType<typeof vi.fn>;
      mockRun: ReturnType<typeof vi.fn>;
    };
  };
}

// Creates a mock that returns different results for sequential all() calls
function createSequentialAllMockDb(allResults: unknown[][], error?: Error) {
  let callIndex = 0;

  const mockFirst = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve(null);
  });

  const mockAll = vi.fn().mockImplementation(() => {
    if (error) throw error;
    const results = allResults[callIndex] ?? [];
    callIndex++;
    return Promise.resolve({ results, success: true });
  });

  const mockRun = vi.fn().mockImplementation(() => {
    if (error) throw error;
    return Promise.resolve({ success: true, meta: { changes: 1 } });
  });

  const mockBind = vi.fn().mockReturnValue({
    first: mockFirst,
    all: mockAll,
    run: mockRun,
  });

  const mockPrepare = vi.fn().mockReturnValue({
    bind: mockBind,
  });

  return {
    prepare: mockPrepare,
    _mocks: { mockPrepare, mockBind, mockFirst, mockAll, mockRun },
  } as unknown as D1Database & {
    _mocks: {
      mockPrepare: ReturnType<typeof vi.fn>;
      mockBind: ReturnType<typeof vi.fn>;
      mockFirst: ReturnType<typeof vi.fn>;
      mockAll: ReturnType<typeof vi.fn>;
      mockRun: ReturnType<typeof vi.fn>;
    };
  };
}

describe('Membership functions', () => {
  describe('getUserMemberships', () => {
    it('returns all memberships for a user', async () => {
      const memberships = [
        {
          user_id: 'user-1',
          group_id: 'group-1',
          role: 'admin',
          joined_at: 1000,
          group_name: 'Family Photos',
          group_owner_id: 'user-1',
        },
        {
          user_id: 'user-1',
          group_id: 'group-2',
          role: 'member',
          joined_at: 2000,
          group_name: 'Work Team',
          group_owner_id: 'user-2',
        },
      ];
      const db = createMockDb(memberships);

      const result = await getUserMemberships(db, 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].group_name).toBe('Family Photos');
      expect(result[0].role).toBe('admin');
      expect(result[0].group_owner_id).toBe('user-1');
      expect(result[1].group_name).toBe('Work Team');
      expect(result[1].role).toBe('member');
      expect(result[1].group_owner_id).toBe('user-2');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1');
    });

    it('returns empty array for user with no groups', async () => {
      const db = createMockDb([]);

      const result = await getUserMemberships(db, 'user-no-groups');

      expect(result).toEqual([]);
    });
  });

  describe('getMembership', () => {
    it('returns correct role for user+group', async () => {
      const membership = {
        user_id: 'user-1',
        group_id: 'group-1',
        role: 'admin',
        joined_at: 1000,
      };
      const db = createMockDb([membership]);

      const result = await getMembership(db, 'user-1', 'group-1');

      expect(result).not.toBeNull();
      expect(result?.role).toBe('admin');
      expect(result?.user_id).toBe('user-1');
      expect(result?.group_id).toBe('group-1');
    });

    it('returns null for non-existent membership', async () => {
      const db = createMockDb([]);

      const result = await getMembership(db, 'user-1', 'group-nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createMembership', () => {
    it('creates a new membership successfully', async () => {
      const db = createMockDb([]);

      await createMembership(db, 'user-1', 'group-1', 'member');

      expect(db._mocks.mockPrepare).toHaveBeenCalled();
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'user-1',
        'group-1',
        'member',
        expect.any(Number)
      );
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });

    it('can create admin membership', async () => {
      const db = createMockDb([]);

      await createMembership(db, 'user-2', 'group-1', 'admin');

      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'user-2',
        'group-1',
        'admin',
        expect.any(Number)
      );
    });

    it('throws error for duplicate membership', async () => {
      const duplicateError = new Error(
        'UNIQUE constraint failed: memberships.user_id, memberships.group_id'
      );
      const db = createMockDb([], duplicateError);

      await expect(createMembership(db, 'user-1', 'group-1', 'member')).rejects.toThrow(
        'UNIQUE constraint failed'
      );
    });
  });

  describe('deleteMembership', () => {
    it('removes non-owner membership and returns success', async () => {
      // First call: getGroup returns group where user is not owner
      // Second call (after getGroup in deleteMembership runs the delete)
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'other-user',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await deleteMembership(db, 'user-1', 'group-1');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });

    it('rejects removing owner and returns error', async () => {
      // getGroup returns group where user IS the owner
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-1',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await deleteMembership(db, 'owner-1', 'group-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('is_owner');
      // Should not have called run() since we reject early
      expect(db._mocks.mockRun).not.toHaveBeenCalled();
    });

    it('removes member successfully', async () => {
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-user',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await deleteMembership(db, 'member-1', 'group-1');

      expect(result.success).toBe(true);
    });
  });

  describe('updateMembershipRole', () => {
    it('updates role from member to admin', async () => {
      // getGroup returns group where user is not owner
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'other-user',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await updateMembershipRole(db, 'user-1', 'group-1', 'admin');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('updates role from admin to member', async () => {
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-user',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await updateMembershipRole(db, 'admin-1', 'group-1', 'member');

      expect(result.success).toBe(true);
    });

    it('rejects changing owner role and returns error', async () => {
      // getGroup returns group where user IS the owner
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-1',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await updateMembershipRole(db, 'owner-1', 'group-1', 'member');

      expect(result.success).toBe(false);
      expect(result.error).toBe('is_owner');
      // Should not have called run() since we reject early
      expect(db._mocks.mockRun).not.toHaveBeenCalled();
    });

    it('rejects demoting owner to admin and returns error', async () => {
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-1',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);

      const result = await updateMembershipRole(db, 'owner-1', 'group-1', 'admin');

      expect(result.success).toBe(false);
      expect(result.error).toBe('is_owner');
    });
  });

  describe('updateMemberImageProtection', () => {
    it('enables image protection', async () => {
      const db = createMockDb();

      const result = await updateMemberImageProtection(db, 'user-1', 'group-1', true);

      expect(result).toBe(true);
      expect(db._mocks.mockBind).toHaveBeenCalledWith(1, 'user-1', 'group-1');
    });

    it('disables image protection', async () => {
      const db = createMockDb();

      const result = await updateMemberImageProtection(db, 'user-1', 'group-1', false);

      expect(result).toBe(true);
      expect(db._mocks.mockBind).toHaveBeenCalledWith(0, 'user-1', 'group-1');
    });

    it('returns false when no row was updated', async () => {
      const db = createMockDb([], undefined);
      db._mocks.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

      const result = await updateMemberImageProtection(db, 'user-1', 'group-1', true);

      expect(result).toBe(false);
    });
  });

  describe('getUserMemberships includes image_protection', () => {
    it('returns image_protection in membership data', async () => {
      const memberships = [
        {
          user_id: 'user-1',
          group_id: 'group-1',
          role: 'member',
          joined_at: 1000,
          image_protection: 1,
          group_name: 'Test Group',
          group_owner_id: 'owner-1',
        },
      ];
      const db = createMockDb(memberships);
      db._mocks.mockAll.mockResolvedValueOnce({ results: memberships, success: true });

      const result = await getUserMemberships(db, 'user-1');

      expect(result[0].image_protection).toBe(1);
      // Verify query includes image_protection
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('m.image_protection')
      );
    });
  });
});

describe('Group deletion functions', () => {
  describe('getGroupPhotoKeys', () => {
    it('returns all photo keys for a group', async () => {
      const photoKeys = [
        { r2_key: 'photos/abc123.jpg', thumbnail_r2_key: 'thumbnails/abc123.jpg' },
        { r2_key: 'photos/def456.jpg', thumbnail_r2_key: 'thumbnails/def456.jpg' },
      ];
      const db = createMockDb(photoKeys);

      const result = await getGroupPhotoKeys(db, 'group-1');

      expect(result).toHaveLength(2);
      expect(result[0].r2_key).toBe('photos/abc123.jpg');
      expect(result[0].thumbnail_r2_key).toBe('thumbnails/abc123.jpg');
      expect(result[1].r2_key).toBe('photos/def456.jpg');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1');
    });

    it('returns empty array for group with no photos', async () => {
      const db = createMockDb([]);

      const result = await getGroupPhotoKeys(db, 'empty-group');

      expect(result).toEqual([]);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('empty-group');
    });

    it('handles photos without thumbnails', async () => {
      const photoKeys = [{ r2_key: 'photos/abc123.jpg', thumbnail_r2_key: null }];
      const db = createMockDb(photoKeys);

      const result = await getGroupPhotoKeys(db, 'group-1');

      expect(result).toHaveLength(1);
      expect(result[0].r2_key).toBe('photos/abc123.jpg');
      expect(result[0].thumbnail_r2_key).toBeNull();
    });
  });

  describe('getGroupPhotoCount', () => {
    it('returns count for group with photos', async () => {
      const db = createMockDb([{ count: 42 }]);

      const result = await getGroupPhotoCount(db, 'group-1');

      expect(result).toBe(42);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM photos WHERE group_id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1');
    });

    it('returns 0 for group with no photos', async () => {
      const db = createMockDb([{ count: 0 }]);

      const result = await getGroupPhotoCount(db, 'empty-group');

      expect(result).toBe(0);
    });

    it('returns 0 when result is null', async () => {
      const db = createMockDb([]);

      const result = await getGroupPhotoCount(db, 'nonexistent-group');

      expect(result).toBe(0);
    });
  });

  describe('deleteGroup', () => {
    it('deletes group and returns success', async () => {
      const db = createMockDb([]);

      const result = await deleteGroup(db, 'group-1');

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith('DELETE FROM groups WHERE id = ?');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });
});

describe('Push subscription functions', () => {
  describe('createPushSubscription', () => {
    it('creates new subscription', async () => {
      const db = createMockDb([]);

      const result = await createPushSubscription(
        db,
        'user-1',
        'group-1',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key'
      );

      expect(result).toBeTruthy();
      expect(db._mocks.mockPrepare).toHaveBeenCalled();
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        expect.any(String), // id
        'user-1',
        'group-1',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        expect.any(String), // deletion_token
        expect.any(Number) // created_at
      );
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });

    it('upserts on duplicate endpoint', async () => {
      const db = createMockDb([]);

      await createPushSubscription(
        db,
        'user-1',
        'group-1',
        'https://push.example.com/abc',
        'new-p256dh',
        'new-auth'
      );

      // Verify the SQL includes ON CONFLICT DO UPDATE
      const prepareCall = db._mocks.mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('ON CONFLICT');
      expect(prepareCall).toContain('DO UPDATE');
    });
  });

  describe('getUserPushSubscriptionsForGroup', () => {
    it('returns all subscriptions for user in group', async () => {
      const subscriptions = [
        {
          id: 'sub-1',
          user_id: 'user-1',
          group_id: 'group-1',
          endpoint: 'https://push.example.com/device1',
          p256dh: 'key1',
          auth: 'auth1',
          created_at: 1000,
        },
        {
          id: 'sub-2',
          user_id: 'user-1',
          group_id: 'group-1',
          endpoint: 'https://push.example.com/device2',
          p256dh: 'key2',
          auth: 'auth2',
          created_at: 2000,
        },
      ];
      const db = createMockDb(subscriptions);

      const result = await getUserPushSubscriptionsForGroup(db, 'user-1', 'group-1');

      expect(result).toHaveLength(2);
      expect(result[0].endpoint).toBe('https://push.example.com/device1');
      expect(result[1].endpoint).toBe('https://push.example.com/device2');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
    });

    it('returns empty array when none exist', async () => {
      const db = createMockDb([]);

      const result = await getUserPushSubscriptionsForGroup(db, 'user-1', 'group-1');

      expect(result).toEqual([]);
    });
  });

  describe('getGroupPushSubscriptions', () => {
    it('returns all subscriptions for group', async () => {
      const subscriptions = [
        {
          id: 'sub-1',
          user_id: 'user-1',
          group_id: 'group-1',
          endpoint: 'https://push.example.com/user1',
          p256dh: 'key1',
          auth: 'auth1',
          created_at: 1000,
        },
        {
          id: 'sub-2',
          user_id: 'user-2',
          group_id: 'group-1',
          endpoint: 'https://push.example.com/user2',
          p256dh: 'key2',
          auth: 'auth2',
          created_at: 2000,
        },
      ];
      const db = createMockDb(subscriptions);

      const result = await getGroupPushSubscriptions(db, 'group-1');

      expect(result).toHaveLength(2);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1');
    });

    it('excludes specified user when excludeUserId provided', async () => {
      const subscriptions = [
        {
          id: 'sub-2',
          user_id: 'user-2',
          group_id: 'group-1',
          endpoint: 'https://push.example.com/user2',
          p256dh: 'key2',
          auth: 'auth2',
          created_at: 2000,
        },
      ];
      const db = createMockDb(subscriptions);

      const result = await getGroupPushSubscriptions(db, 'group-1', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-2');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1', 'user-1');
    });

    it('returns empty array for group with no subscriptions', async () => {
      const db = createMockDb([]);

      const result = await getGroupPushSubscriptions(db, 'group-empty');

      expect(result).toEqual([]);
    });
  });

  describe('deletePushSubscription', () => {
    it('removes subscription by endpoint', async () => {
      const db = createMockDb([]);

      await deletePushSubscription(db, 'https://push.example.com/abc');

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM push_subscriptions WHERE endpoint = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('https://push.example.com/abc');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('deletePushSubscriptionForGroup', () => {
    it('removes subscription for specific user+group+endpoint', async () => {
      const db = createMockDb([]);

      const result = await deletePushSubscriptionForGroup(
        db,
        'user-1',
        'group-1',
        'https://push.example.com/abc'
      );

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND group_id = ? AND endpoint = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'user-1',
        'group-1',
        'https://push.example.com/abc'
      );
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('deleteAllUserPushSubscriptionsForGroup', () => {
    it('removes all subscriptions for a user in a specific group', async () => {
      const db = createMockDb([]);

      await deleteAllUserPushSubscriptionsForGroup(db, 'user-1', 'group-1');

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND group_id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });
});

describe('Device token functions (native push)', () => {
  describe('createDeviceToken', () => {
    it('creates new device token', async () => {
      const db = createMockDb([]);

      const result = await createDeviceToken(db, 'user-1', 'group-1', 'android', 'fcm-token-123');

      expect(result).toBeTruthy();
      expect(db._mocks.mockPrepare).toHaveBeenCalled();
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        expect.any(String), // id
        'user-1',
        'group-1',
        'android',
        'fcm-token-123',
        expect.any(Number) // created_at
      );
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });

    it('upserts on duplicate user+group+token', async () => {
      const db = createMockDb([]);

      await createDeviceToken(db, 'user-1', 'group-1', 'ios', 'fcm-token-123');

      const prepareCall = db._mocks.mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('ON CONFLICT');
      expect(prepareCall).toContain('DO UPDATE');
    });

    it('accepts ios platform', async () => {
      const db = createMockDb([]);

      await createDeviceToken(db, 'user-1', 'group-1', 'ios', 'apns-token-456');

      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        'group-1',
        'ios',
        'apns-token-456',
        expect.any(Number)
      );
    });
  });

  describe('getDeviceToken', () => {
    it('returns device token for user+group+token', async () => {
      const deviceToken = {
        id: 'dt-1',
        user_id: 'user-1',
        group_id: 'group-1',
        platform: 'android',
        token: 'fcm-token-123',
        created_at: 1000,
      };
      const db = createMockDb([deviceToken]);

      const result = await getDeviceToken(db, 'user-1', 'group-1', 'fcm-token-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('dt-1');
      expect(result?.platform).toBe('android');
      expect(result?.token).toBe('fcm-token-123');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1', 'fcm-token-123');
    });

    it('returns null for non-existent token', async () => {
      const db = createMockDb([]);

      const result = await getDeviceToken(db, 'user-1', 'group-1', 'nonexistent-token');

      expect(result).toBeNull();
    });
  });

  describe('getGroupDeviceTokens', () => {
    it('returns all device tokens for group', async () => {
      const deviceTokens = [
        {
          id: 'dt-1',
          user_id: 'user-1',
          group_id: 'group-1',
          platform: 'android',
          token: 'token-1',
          created_at: 1000,
        },
        {
          id: 'dt-2',
          user_id: 'user-2',
          group_id: 'group-1',
          platform: 'ios',
          token: 'token-2',
          created_at: 2000,
        },
      ];
      const db = createMockDb(deviceTokens);

      const result = await getGroupDeviceTokens(db, 'group-1');

      expect(result).toHaveLength(2);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1');
    });

    it('excludes specified user when excludeUserId provided', async () => {
      const deviceTokens = [
        {
          id: 'dt-2',
          user_id: 'user-2',
          group_id: 'group-1',
          platform: 'ios',
          token: 'token-2',
          created_at: 2000,
        },
      ];
      const db = createMockDb(deviceTokens);

      const result = await getGroupDeviceTokens(db, 'group-1', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-2');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1', 'user-1');
    });

    it('returns empty array for group with no tokens', async () => {
      const db = createMockDb([]);

      const result = await getGroupDeviceTokens(db, 'group-empty');

      expect(result).toEqual([]);
    });
  });

  describe('deleteDeviceToken', () => {
    it('removes token for specific user+group+token', async () => {
      const db = createMockDb([]);

      const result = await deleteDeviceToken(db, 'user-1', 'group-1', 'fcm-token-123');

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM device_tokens WHERE user_id = ? AND group_id = ? AND token = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1', 'fcm-token-123');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('deleteDeviceTokenByToken', () => {
    it('removes token by token value only', async () => {
      const db = createMockDb([]);

      await deleteDeviceTokenByToken(db, 'fcm-token-123');

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM device_tokens WHERE token = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('fcm-token-123');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('countUserDeviceTokensSince', () => {
    it('counts tokens created since given timestamp', async () => {
      const db = createMockDb([{ count: 5 }]);
      const sinceTimestamp = 1700000000;

      const result = await countUserDeviceTokensSince(db, 'user-1', sinceTimestamp);

      expect(result).toBe(5);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM device_tokens WHERE user_id = ? AND created_at >= ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', sinceTimestamp);
    });

    it('returns 0 when no tokens found', async () => {
      const db = createMockDb([null]);

      const result = await countUserDeviceTokensSince(db, 'user-1', 1700000000);

      expect(result).toBe(0);
    });
  });
});

describe('Comment functions', () => {
  describe('createComment', () => {
    it('creates comment with author_name', async () => {
      const db = createMockDb([]);

      const result = await createComment(db, 'photo-1', 'user-1', 'John Doe', 'Great photo!');

      expect(result).toBeTruthy();
      expect(db._mocks.mockPrepare).toHaveBeenCalled();
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        expect.any(String), // id
        'photo-1',
        'user-1',
        'John Doe',
        'Great photo!',
        expect.any(Number) // created_at
      );
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('getCommentsByPhotoId', () => {
    it('returns comments for photo', async () => {
      const comments = [
        {
          id: 'comment-1',
          photo_id: 'photo-1',
          user_id: 'user-1',
          author_name: 'John',
          content: 'Nice!',
          created_at: 1000,
        },
        {
          id: 'comment-2',
          photo_id: 'photo-1',
          user_id: 'user-2',
          author_name: 'Jane',
          content: 'Love it!',
          created_at: 2000,
        },
      ];
      const db = createMockDb(comments);

      const result = await getCommentsByPhotoId(db, 'photo-1');

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Nice!');
      expect(result[0].author_name).toBe('John');
      expect(result[1].content).toBe('Love it!');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('photo-1');
    });

    it('returns empty array when none exist', async () => {
      const db = createMockDb([]);

      const result = await getCommentsByPhotoId(db, 'photo-empty');

      expect(result).toEqual([]);
    });
  });

  describe('getComment', () => {
    it('returns comment by id', async () => {
      const comment = {
        id: 'comment-1',
        photo_id: 'photo-1',
        user_id: 'user-1',
        author_name: 'John',
        content: 'Nice!',
        created_at: 1000,
      };
      const db = createMockDb([comment]);

      const result = await getComment(db, 'comment-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('comment-1');
      expect(result?.content).toBe('Nice!');
    });

    it('returns null for non-existent comment', async () => {
      const db = createMockDb([]);

      const result = await getComment(db, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteComment', () => {
    it('soft-deletes comment by nulling user_id and content', async () => {
      const db = createMockDb([]);

      const result = await deleteComment(db, 'comment-1');

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE comments SET user_id = NULL')
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith(expect.any(Number), 'comment-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });
});

describe('Reaction functions', () => {
  describe('getPhotoReactionsWithUsers', () => {
    it('returns reactions with user details', async () => {
      const reactions = [
        {
          photo_id: 'photo-1',
          user_id: 'user-1',
          emoji: '❤️',
          created_at: 1000,
          user_name: 'John',
        },
        {
          photo_id: 'photo-1',
          user_id: 'user-2',
          emoji: '😂',
          created_at: 2000,
          user_name: 'Jane',
        },
      ];
      const db = createMockDb(reactions);

      const result = await getPhotoReactionsWithUsers(db, 'photo-1');

      expect(result).toHaveLength(2);
      expect(result[0].emoji).toBe('❤️');
      expect(result[0].user_name).toBe('John');
      expect(result[1].emoji).toBe('😂');
      expect(result[1].user_name).toBe('Jane');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('photo-1');
    });

    it('returns empty array when no reactions', async () => {
      const db = createMockDb([]);

      const result = await getPhotoReactionsWithUsers(db, 'photo-1');

      expect(result).toEqual([]);
    });
  });
});

describe('listPhotosWithCounts', () => {
  it('returns photos with correct counts', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: 'Test photo',
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 5,
      },
    ];
    const reactions = [
      { photo_id: 'photo-1', emoji: '❤️', count: 7, reacted_by_user: 1 },
      { photo_id: 'photo-1', emoji: '😂', count: 3, reacted_by_user: 0 },
    ];
    const db = createSequentialAllMockDb([photos, reactions]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 20, 0);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('photo-1');
    expect(result[0].comment_count).toBe(5);
    expect(result[0].reaction_count).toBe(10);
    expect(result[0].user_reactions).toEqual(['❤️']);
    expect(result[0].reactions).toHaveLength(2);
    expect(result[0].reactions[0]).toEqual({ emoji: '❤️', count: 7 });
    expect(result[0].reactions[1]).toEqual({ emoji: '😂', count: 3 });
  });

  it('returns multiple user reactions for a photo', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: 'Test photo',
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 0,
      },
    ];
    const reactions = [
      { photo_id: 'photo-1', emoji: '❤️', count: 2, reacted_by_user: 1 },
      { photo_id: 'photo-1', emoji: '🔥', count: 1, reacted_by_user: 1 },
      { photo_id: 'photo-1', emoji: '😂', count: 4, reacted_by_user: 0 },
    ];
    const db = createSequentialAllMockDb([photos, reactions]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 20, 0);

    expect(result[0].user_reactions).toEqual(['❤️', '🔥']);
    expect(result[0].reaction_count).toBe(7);
  });

  it('handles photos with no reactions or comments', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: null,
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 0,
      },
    ];
    const reactions: unknown[] = [];
    const db = createSequentialAllMockDb([photos, reactions]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 20, 0);

    expect(result).toHaveLength(1);
    expect(result[0].comment_count).toBe(0);
    expect(result[0].reaction_count).toBe(0);
    expect(result[0].user_reactions).toEqual([]);
    expect(result[0].reactions).toEqual([]);
  });

  it('returns empty array for group with no photos', async () => {
    const db = createSequentialAllMockDb([[], []]);

    const result = await listPhotosWithCounts(db, 'group-empty', 'user-1', 20, 0);

    expect(result).toEqual([]);
  });

  it('correctly aggregates reaction summaries per photo for multiple photos', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: 'First',
        uploaded_by: 'user-1',
        uploaded_at: 2000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 2,
      },
      {
        id: 'photo-2',
        group_id: 'group-1',
        r2_key: 'photos/2.jpg',
        caption: 'Second',
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/2.jpg',
        comment_count: 0,
      },
    ];
    const reactions = [
      { photo_id: 'photo-1', emoji: '❤️', count: 3, reacted_by_user: 1 },
      { photo_id: 'photo-1', emoji: '🔥', count: 2, reacted_by_user: 0 },
      { photo_id: 'photo-2', emoji: '😂', count: 3, reacted_by_user: 0 },
    ];
    const db = createSequentialAllMockDb([photos, reactions]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 20, 0);

    expect(result).toHaveLength(2);

    // First photo
    expect(result[0].id).toBe('photo-1');
    expect(result[0].reactions).toHaveLength(2);
    expect(result[0].reactions).toContainEqual({ emoji: '❤️', count: 3 });
    expect(result[0].reactions).toContainEqual({ emoji: '🔥', count: 2 });

    // Second photo
    expect(result[1].id).toBe('photo-2');
    expect(result[1].reactions).toHaveLength(1);
    expect(result[1].reactions[0]).toEqual({ emoji: '😂', count: 3 });
  });

  it('passes correct parameters to queries', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: 'Test',
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 0,
      },
    ];
    const db = createSequentialAllMockDb([photos, []]);

    await listPhotosWithCounts(db, 'group-1', 'user-1', 10, 5);

    // First call: photos query with groupId, limit, offset
    expect(db._mocks.mockBind).toHaveBeenNthCalledWith(1, 'group-1', 10, 5);
    // Second call: reactions query with userId then photo IDs
    expect(db._mocks.mockBind).toHaveBeenNthCalledWith(2, 'user-1', 'photo-1');
  });
});

describe('Profile color functions', () => {
  describe('PROFILE_COLORS', () => {
    it('contains exactly 20 colors', () => {
      expect(PROFILE_COLORS).toHaveLength(20);
    });

    it('contains all expected color names', () => {
      const expected = [
        'terracotta',
        'coral',
        'amber',
        'rust',
        'clay',
        'copper',
        'sienna',
        'sage',
        'olive',
        'forest',
        'moss',
        'jade',
        'slate',
        'ocean',
        'teal',
        'indigo',
        'plum',
        'wine',
        'mauve',
        'rose',
      ];
      expect([...PROFILE_COLORS]).toEqual(expected);
    });

    it('contains no duplicates', () => {
      const unique = new Set(PROFILE_COLORS);
      expect(unique.size).toBe(PROFILE_COLORS.length);
    });
  });

  describe('getRandomProfileColor', () => {
    it('returns a valid profile color', () => {
      const color = getRandomProfileColor();
      expect(PROFILE_COLORS).toContain(color);
    });

    it('returns colors from the palette across multiple calls', () => {
      const colors = new Set<ProfileColor>();
      for (let i = 0; i < 100; i++) {
        colors.add(getRandomProfileColor());
      }
      // With 100 random picks from 20 colors, we should get at least a few different ones
      expect(colors.size).toBeGreaterThan(1);
    });
  });

  describe('createUser', () => {
    it('inserts user with profile_color', async () => {
      const db = createMockDb([]);

      const userId = await createUser(db, 'Test User', 'test@example.com');

      expect(userId).toBeTruthy();
      expect(db._mocks.mockPrepare).toHaveBeenCalled();
      const prepareCall = db._mocks.mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('profile_color');
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        expect.any(String), // id
        'Test User',
        'test@example.com',
        expect.any(String), // profile_color (random)
        expect.any(Number) // created_at
      );

      // Verify the profile_color is a valid one
      const profileColor = db._mocks.mockBind.mock.calls[0][3] as ProfileColor;
      expect(PROFILE_COLORS).toContain(profileColor);
    });
  });

  describe('updateUserProfileColor', () => {
    it('updates profile color', async () => {
      const db = createMockDb([]);

      const result = await updateUserProfileColor(db, 'user-1', 'sage');

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'UPDATE users SET profile_color = ? WHERE id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('sage', 'user-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });
});
