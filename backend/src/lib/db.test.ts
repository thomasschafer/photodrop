import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getUserMemberships,
  getMembership,
  createMembership,
  deleteMembership,
  updateMembershipRole,
  updateMemberImageProtection,
  updateMemberDisplayName,
  getResolvedMemberName,
  getMemberNames,
  getGroupMembers,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
  deletePhoto,
  updateUserProfile,
  createPushSubscription,
  countUserPushSubscriptionsForGroup,
  getUserPushSubscriptionsForGroup,
  getGroupPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionForGroup,
  deleteAllUserPushSubscriptionsForGroup,
  createDeviceToken,
  getDeviceToken,
  getGroupDeviceTokens,
  deleteUserDeviceTokensForToken,
  deleteDeviceTokenForOtherUsers,
  deleteAllUserDeviceTokensForGroup,
  deleteDeviceTokenByToken,
  countUserDeviceTokensSince,
  markMagicLinkTokenUsed,
  createComment,
  getCommentsByPhotoId,
  getComment,
  deleteComment,
  getPhotoReactionsWithUsers,
  listPhotosWithCounts,
  createUser,
  createSession,
  getSessionByFamily,
  rotateSession,
  touchSession,
  deleteSessionFamily,
  pruneExpiredSessions,
  anonymizeUserAccount,
  transferGroupOwnership,
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
      const db = createMockDb();

      const result = await deleteMembership(db, 'user-1', 'group-1');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(db._mocks.mockRun).toHaveBeenCalled();
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'));
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1', 'group-1', 'user-1');
    });

    it('rejects removing owner and returns error', async () => {
      const group = {
        id: 'group-1',
        name: 'Test Group',
        owner_id: 'owner-1',
        created_at: 1000,
      };
      const db = createSequentialMockDb([group]);
      db._mocks.mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

      const result = await deleteMembership(db, 'owner-1', 'group-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('is_owner');
      // The guarded DELETE runs first, then the ownership read explains why
      // no row changed without opening a race between a check and the DELETE.
      expect(db._mocks.mockRun).toHaveBeenCalledOnce();
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

  describe('display names', () => {
    describe('getGroupMembers', () => {
      it('resolves each name against this group, and exposes the raw override', async () => {
        const members = [
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
        ];
        const db = createMockDb(members);

        const { members: result } = await getGroupMembers(db, 'group-1');

        expect(result[0].user_name).toBe('Mum');
        expect(result[0].display_name).toBe('Mum');
        // The mocked rows would map through whatever the query asked for, so
        // pin the resolution itself: reading u.name directly here would show
        // the canonical name beside members who have an override.
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('COALESCE(m.display_name, u.name) as user_name')
        );
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('m.display_name')
        );
      });

      it('carries the canonical name alongside the resolved one', async () => {
        const members = [
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
        ];
        const db = createMockDb(members);

        const { members: result } = await getGroupMembers(db, 'group-1');

        expect(result[0].canonical_name).toBe('Jane Doe');
        // Only the admin members list may show it, so it has to be selected
        // separately rather than inferred from the resolved name.
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('u.name as canonical_name')
        );
      });
    });

    describe('getMemberNames', () => {
      it('returns both the name this group sees and the user’s own name', async () => {
        const db = createMockDb([{ resolved_name: 'Mum', canonical_name: 'Jane Doe' }]);

        const result = await getMemberNames(db, 'user-1', 'group-1');

        expect(result).toEqual({ resolvedName: 'Mum', canonicalName: 'Jane Doe' });
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('COALESCE(m.display_name, u.name) as resolved_name')
        );
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('u.name as canonical_name')
        );
        expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
      });

      it('returns null when the user is not a member of the group', async () => {
        const db = createMockDb([]);

        await expect(getMemberNames(db, 'user-1', 'group-1')).resolves.toBeNull();
      });
    });

    describe('getResolvedMemberName', () => {
      it('returns the name this group sees for the user, and nothing else', async () => {
        const db = createMockDb([{ resolved_name: 'Mum', canonical_name: 'Jane Doe' }]);

        const result = await getResolvedMemberName(db, 'user-1', 'group-1');

        expect(result).toBe('Mum');
        expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
      });

      it('returns null when the user is not a member of the group', async () => {
        const db = createMockDb([]);

        await expect(getResolvedMemberName(db, 'user-1', 'group-1')).resolves.toBeNull();
      });
    });

    describe('updateMemberDisplayName', () => {
      it('sets an override on that one membership only', async () => {
        const db = createMockDb();

        const result = await updateMemberDisplayName(db, 'user-1', 'group-1', 'Mum');

        expect(result).toBe(true);
        expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
          'UPDATE memberships SET display_name = ? WHERE user_id = ? AND group_id = ?'
        );
        expect(db._mocks.mockBind).toHaveBeenCalledWith('Mum', 'user-1', 'group-1');
      });

      it('clears the override by writing null', async () => {
        const db = createMockDb();

        const result = await updateMemberDisplayName(db, 'user-1', 'group-1', null);

        expect(result).toBe(true);
        expect(db._mocks.mockBind).toHaveBeenCalledWith(null, 'user-1', 'group-1');
      });
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
      // The caller's own display name for each group comes from this query.
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(expect.stringContaining('m.display_name'));
    });
  });
});

describe('anonymizeUserAccount', () => {
  function createBatchDb(changes: number[]) {
    const sql: string[] = [];
    const batch = vi
      .fn()
      .mockResolvedValue(changes.map((count) => ({ success: true, meta: { changes: count } })));
    const prepare = vi.fn((statement: string) => {
      sql.push(statement);
      const prepared = {
        bind: vi.fn(() => prepared),
      };
      return prepared;
    });
    return {
      db: { prepare, batch } as unknown as D1Database,
      sql,
      batch,
    };
  }

  const user = {
    id: 'user-1',
    email: 'jane@example.com',
    name: 'Jane',
    profile_color: 'teal' as const,
    created_at: 1000,
    last_seen_at: 1000,
    deleted_at: null,
  };

  it('gates every cleanup and token mutation on the ownership-safe tombstone', async () => {
    const { db, sql, batch } = createBatchDb(new Array(10).fill(1));

    await expect(anonymizeUserAccount(db, user, 'delete-token')).resolves.toBe(true);

    expect(batch).toHaveBeenCalledOnce();
    expect(sql).toHaveLength(10);
    expect(sql[0]).toContain('NOT EXISTS (SELECT 1 FROM groups WHERE owner_id = ?)');
    for (const cleanup of sql.slice(1)) {
      expect(cleanup).toContain('deleted_at = ?');
    }
    expect(sql[9]).toContain('used_at IS NULL');
  });

  it('reports a blocked tombstone or unburned token as unsuccessful', async () => {
    const { db } = createBatchDb(new Array(10).fill(0));

    await expect(anonymizeUserAccount(db, user, 'delete-token')).resolves.toBe(false);
  });

  it('reports an unburned token as unsuccessful after the tombstone succeeds', async () => {
    const changes = new Array(10).fill(1);
    changes[9] = 0;
    const { db } = createBatchDb(changes);

    await expect(anonymizeUserAccount(db, user, 'delete-token')).resolves.toBe(false);
  });
});

describe('transferGroupOwnership', () => {
  it('is safe to retry when the requested owner is already in place', async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => {
      const statement = {
        bind: vi.fn((...bindings: unknown[]) => {
          statements.push({ sql, bindings });
          return statement;
        }),
      };
      return statement;
    });
    const db = {
      prepare,
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 0 } }]),
    } as unknown as D1Database;

    await expect(transferGroupOwnership(db, 'group-1', 'owner-1', 'owner-2')).resolves.toBe(true);
    expect(statements[0].sql).toContain('owner_id IN (?, ?)');
    expect(statements[0].bindings).toEqual([
      'owner-2',
      'group-1',
      'owner-1',
      'owner-2',
      'owner-2',
      'group-1',
    ]);
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

      // Verify the SQL includes ON CONFLICT DO UPDATE, guarded on the owner so
      // the upsert can refresh a row but never reassign it.
      const prepareCall = db._mocks.mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('ON CONFLICT');
      expect(prepareCall).toContain('DO UPDATE');
      expect(prepareCall).toContain('WHERE push_subscriptions.user_id = excluded.user_id');
    });

    it('reports an endpoint owned by another user instead of taking it over', async () => {
      const db = createMockDb([]);
      // The guarded upsert matches no row when the endpoint belongs to someone
      // else, which D1 reports as zero changes.
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 0 } });

      const result = await createPushSubscription(
        db,
        'user-2',
        'group-1',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key'
      );

      expect(result).toEqual({ error: 'endpoint_owned_by_another_user' });
    });
  });

  describe('countUserPushSubscriptionsForGroup', () => {
    it('counts the user rows for a group, excluding the endpoint being subscribed', async () => {
      const db = createMockDb([{ count: 4 }]);

      const result = await countUserPushSubscriptionsForGroup(
        db,
        'user-1',
        'group-1',
        'https://push.example.com/abc'
      );

      expect(result).toBe(4);
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'user-1',
        'group-1',
        'https://push.example.com/abc'
      );
      expect(db._mocks.mockPrepare.mock.calls[0][0]).toContain('endpoint != ?');
    });

    it('returns 0 when the count row is missing', async () => {
      const db = createMockDb([null]);

      await expect(
        countUserPushSubscriptionsForGroup(db, 'user-1', 'group-1', 'https://push.example.com/abc')
      ).resolves.toBe(0);
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

    it('only returns subscriptions whose owner is still a member of the group', async () => {
      const db = createMockDb([]);

      await getGroupPushSubscriptions(db, 'group-1');

      const query = db._mocks.mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain(
        'JOIN memberships m ON m.user_id = ps.user_id AND m.group_id = ps.group_id'
      );
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

    it('only returns tokens whose owner is still a member of the group', async () => {
      const db = createMockDb([]);

      await getGroupDeviceTokens(db, 'group-1');

      // Rows left behind by a removed member must not receive the group's
      // notifications, so the query joins memberships rather than trusting
      // cleanup to have happened.
      const query = db._mocks.mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain(
        'JOIN memberships m ON m.user_id = dt.user_id AND m.group_id = dt.group_id'
      );
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

  describe('deleteUserDeviceTokensForToken', () => {
    it('removes the token from every group the user registered it in', async () => {
      const db = createMockDb([]);
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 3 } });

      const result = await deleteUserDeviceTokensForToken(db, 'user-1', 'fcm-token-123');

      expect(result).toBe(3);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM device_tokens WHERE user_id = ? AND token = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'fcm-token-123');
    });
  });

  describe('deleteDeviceTokenForOtherUsers', () => {
    it('detaches the token from every other account', async () => {
      const db = createMockDb([]);
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 2 } });

      const result = await deleteDeviceTokenForOtherUsers(db, 'user-2', 'fcm-token-123');

      expect(result).toBe(2);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM device_tokens WHERE token = ? AND user_id != ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('fcm-token-123', 'user-2');
    });
  });

  describe('deleteAllUserDeviceTokensForGroup', () => {
    it('removes every token a user has for one group', async () => {
      const db = createMockDb([]);

      await deleteAllUserDeviceTokensForGroup(db, 'user-1', 'group-1');

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM device_tokens WHERE user_id = ? AND group_id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
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

    it("resolves author names against the group the comment's photo is in", async () => {
      const db = createMockDb([]);

      await getCommentsByPhotoId(db, 'photo-1');

      // Guarded on the membership existing: resolving straight through COALESCE
      // would fall back to u.name for an author who has left the group, handing
      // the group the canonical name their display name was hiding.
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'CASE WHEN m.user_id IS NULL THEN NULL ELSE COALESCE(m.display_name, u.name) END as user_name'
        )
      );
      // The photo join supplies that group; without it the membership row
      // matched could be from any group the author belongs to.
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('JOIN photos p ON p.id = c.photo_id')
      );
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'LEFT JOIN memberships m ON m.user_id = c.user_id AND m.group_id = p.group_id'
        )
      );
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

    it('shows a neutral label for a reactor who has left the group', async () => {
      // The membership row is gone, so the query resolves no name: the reaction
      // stays visible but the group must not be shown the canonical name a
      // display name was standing in for.
      const db = createMockDb([
        {
          photo_id: 'photo-1',
          user_id: 'user-gone',
          emoji: '❤️',
          created_at: 1000,
          user_name: null,
          user_profile_color: 'teal',
        },
      ]);

      const result = await getPhotoReactionsWithUsers(db, 'photo-1');

      expect(result[0].user_name).toBe('Former member');
      expect(result[0].user_profile_color).toBeNull();
    });

    it('resolves reactor names against the group the reacted-to photo is in', async () => {
      const db = createMockDb([]);

      await getPhotoReactionsWithUsers(db, 'photo-1');

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'CASE WHEN m.user_id IS NULL THEN NULL ELSE COALESCE(m.display_name, u.name) END as user_name'
        )
      );
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('JOIN photos p ON p.id = pr.photo_id')
      );
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'LEFT JOIN memberships m ON m.user_id = pr.user_id AND m.group_id = p.group_id'
        )
      );
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

  it('carries the uploader through, labels former members, and nulls when their account is gone', async () => {
    const photos = [
      {
        id: 'photo-1',
        group_id: 'group-1',
        r2_key: 'photos/1.jpg',
        caption: 'Has an uploader',
        uploaded_by: 'user-1',
        uploaded_at: 1000,
        thumbnail_r2_key: 'thumbs/1.jpg',
        comment_count: 0,
        uploader_user_id: 'user-1',
        uploader_name: 'Alice',
        uploader_profile_color: 'teal',
      },
      {
        id: 'photo-2',
        group_id: 'group-1',
        r2_key: 'photos/2.jpg',
        caption: 'Uploader deleted',
        uploaded_by: 'user-gone',
        uploaded_at: 900,
        thumbnail_r2_key: 'thumbs/2.jpg',
        comment_count: 0,
        uploader_user_id: null,
        uploader_name: null,
        uploader_profile_color: null,
      },
      {
        id: 'photo-3',
        group_id: 'group-1',
        r2_key: 'photos/3.jpg',
        caption: 'Uploader left the group',
        uploaded_by: 'user-left',
        uploaded_at: 800,
        thumbnail_r2_key: 'thumbs/3.jpg',
        comment_count: 0,
        // The account still exists; only the membership that resolved their
        // name for this group is gone.
        uploader_user_id: 'user-left',
        uploader_name: null,
        uploader_profile_color: 'sage',
      },
    ];
    const db = createSequentialAllMockDb([photos, []]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 20, 0);

    expect(result[0].uploader_name).toBe('Alice');
    expect(result[0].uploader_profile_color).toBe('teal');
    expect(result[1].uploader_name).toBeNull();
    expect(result[1].uploader_profile_color).toBeNull();
    // A removed member is labelled rather than nulled, so the feed still
    // distinguishes them from a deleted account — and never names them.
    expect(result[2].uploader_name).toBe('Former member');
    expect(result[2].uploader_profile_color).toBeNull();

    // The mocked rows would map through even if the query stopped asking for
    // the uploader, so pin the projection and the joins that produce them.
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining(
        'CASE WHEN m.user_id IS NULL THEN NULL ELSE COALESCE(m.display_name, u.name) END as uploader_name'
      )
    );
    // The account-exists signal the label depends on: without it a removed
    // member and a deleted account are indistinguishable.
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('u.id as uploader_user_id')
    );
    // Scoped to the photo's own group, so an uploader's display name in some
    // other group can never be the one shown here.
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining(
        'LEFT JOIN memberships m ON m.user_id = p.uploaded_by AND m.group_id = p.group_id'
      )
    );
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('u.profile_color as uploader_profile_color')
    );
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN users u ON u.id = p.uploaded_by')
    );
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

  it('keeps the reaction query under D1s bound-parameter cap for a full page', async () => {
    // The route asks for limit + 1 rows, so the largest page it can request is
    // 101 photos. Binding the user id plus one parameter per photo in a single
    // statement would exceed D1's 100-parameter limit and fail the whole
    // request, so the ids are chunked.
    const D1_MAX_BOUND_PARAMS = 100;
    const photos = Array.from({ length: 101 }, (_, i) => ({
      id: `photo-${i}`,
      group_id: 'group-1',
      r2_key: `photos/${i}.jpg`,
      caption: null,
      uploaded_by: 'user-1',
      uploaded_at: 1000 + i,
      thumbnail_r2_key: `thumbs/${i}.jpg`,
      comment_count: 0,
      uploader_name: 'Alice',
      uploader_profile_color: 'teal',
    }));
    // One reaction on the first photo of the page and one on the last, so the
    // merged result has to include rows from more than one chunk.
    const db = createSequentialAllMockDb([
      photos,
      [{ photo_id: 'photo-0', emoji: '❤️', count: 2, reacted_by_user: 1 }],
      [{ photo_id: 'photo-100', emoji: '🔥', count: 1, reacted_by_user: 0 }],
    ]);

    const result = await listPhotosWithCounts(db, 'group-1', 'user-1', 101, 0);

    expect(result).toHaveLength(101);
    expect(result[0].reactions).toEqual([{ emoji: '❤️', count: 2 }]);
    expect(result[0].user_reactions).toEqual(['❤️']);
    expect(result[100].reactions).toEqual([{ emoji: '🔥', count: 1 }]);
    expect(result[100].reaction_count).toBe(1);

    // Every photo id must be covered exactly once, across statements that each
    // stay within the cap.
    const reactionBindCalls = db._mocks.mockBind.mock.calls.slice(1);
    expect(reactionBindCalls.length).toBeGreaterThan(1);
    for (const call of reactionBindCalls) {
      expect(call.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
      expect(call[0]).toBe('user-1');
    }
    const boundPhotoIds = reactionBindCalls.flatMap((call) => call.slice(1));
    expect(boundPhotoIds).toEqual(photos.map((p) => p.id));
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

  describe('updateUserProfile', () => {
    it('updates profile color', async () => {
      const db = createMockDb([]);

      const result = await updateUserProfile(db, 'user-1', { profileColor: 'sage' });

      expect(result).toBe(true);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'UPDATE users SET profile_color = ? WHERE id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('sage', 'user-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });

    it('updates the name on its own', async () => {
      const db = createMockDb([]);

      await updateUserProfile(db, 'user-1', { name: 'Jane Smith' });

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith('UPDATE users SET name = ? WHERE id = ?');
      expect(db._mocks.mockBind).toHaveBeenCalledWith('Jane Smith', 'user-1');
    });

    it('writes both fields in a single statement', async () => {
      // D1 has no transaction to roll back a second statement that fails after
      // the first landed, so a request that changes both fields must be one
      // statement or it is not all-or-nothing at all.
      const db = createMockDb([]);

      await updateUserProfile(db, 'user-1', { name: 'Jane Smith', profileColor: 'sage' });

      expect(db._mocks.mockPrepare).toHaveBeenCalledTimes(1);
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'UPDATE users SET name = ?, profile_color = ? WHERE id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('Jane Smith', 'sage', 'user-1');
      expect(db._mocks.mockRun).toHaveBeenCalledTimes(1);
    });

    it('throws rather than issuing an update with nothing to set', async () => {
      const db = createMockDb([]);

      await expect(updateUserProfile(db, 'user-1', {})).rejects.toThrow(
        'updateUserProfile called with no fields to update'
      );
      expect(db._mocks.mockPrepare).not.toHaveBeenCalled();
    });
  });
});

describe('markMagicLinkTokenUsed', () => {
  it('only consumes a token that has not been used yet', async () => {
    const db = createMockDb([]);

    const consumed = await markMagicLinkTokenUsed(db, 'token-1');

    expect(consumed).toBe(true);
    // The used_at condition is what makes the consume atomic: concurrent
    // redemptions of one link cannot both match the row.
    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      'UPDATE magic_link_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL'
    );
  });

  it('reports false when another request already consumed the token', async () => {
    const db = createMockDb([]);
    db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 0 } });

    await expect(markMagicLinkTokenUsed(db, 'token-1')).resolves.toBe(false);
  });
});

describe('mutations report rows affected rather than statement success', () => {
  // D1 reports success for a statement that legitimately matched nothing, so
  // these helpers key off meta.changes instead. Routes surface the false path
  // as a 404/500, so a helper that reported success for a missing row would
  // silently turn "nothing to do" into "done".
  const cases: Array<{ name: string; run: (db: D1Database) => Promise<boolean> }> = [
    { name: 'deleteGroup', run: (db) => deleteGroup(db, 'group-1') },
    { name: 'deletePhoto', run: (db) => deletePhoto(db, 'photo-1', 'group-1') },
    {
      name: 'updateUserProfile',
      run: (db) => updateUserProfile(db, 'user-1', { name: 'New Name' }),
    },
    {
      name: 'updateMemberDisplayName',
      run: (db) => updateMemberDisplayName(db, 'user-1', 'group-1', 'Mum'),
    },
    { name: 'deleteComment', run: (db) => deleteComment(db, 'comment-1') },
    {
      name: 'deleteMembership',
      run: async (db) => (await deleteMembership(db, 'user-1', 'group-1')).success,
    },
    {
      name: 'updateMembershipRole',
      run: async (db) => (await updateMembershipRole(db, 'user-1', 'group-1', 'admin')).success,
    },
  ];

  it.each(cases)('$name reports false when no row matched', async ({ run }) => {
    const db = createMockDb();
    db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 0 } });

    await expect(run(db)).resolves.toBe(false);
  });

  it.each(cases)('$name reports true when a row was changed', async ({ run }) => {
    // createMockDb's default run() reports one changed row.
    await expect(run(createMockDb())).resolves.toBe(true);
  });
});

describe('Session functions', () => {
  const NOW = 1_700_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('seeds previous_jti and rotated_at from the new token', async () => {
      const db = createMockDb();

      await createSession(db, 'user-1', 'family-1', 'jti-1', NOW + 100);

      // previous_jti is never null, so the rotation logic has one less case to
      // handle: a session that has never rotated points at itself.
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'jti-1',
        'jti-1',
        'family-1',
        'user-1',
        NOW,
        NOW,
        NOW,
        NOW + 100
      );
    });
  });

  describe('getSessionByFamily', () => {
    it('looks the session up by family, not by token id', async () => {
      // A replayed token names a jti the row no longer holds; only the family
      // id can still find it.
      const db = createMockDb([{ jti: 'jti-2', family_id: 'family-1' }]);

      const session = await getSessionByFamily(db, 'family-1');

      expect(session?.jti).toBe('jti-2');
      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'SELECT * FROM sessions WHERE family_id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('family-1');
    });

    it('returns null when the family has been revoked', async () => {
      const db = createMockDb([]);

      await expect(getSessionByFamily(db, 'family-1')).resolves.toBeNull();
    });
  });

  describe('rotateSession', () => {
    it('only matches the family’s current, unexpired token', async () => {
      const db = createMockDb();

      const rotated = await rotateSession(db, 'family-1', 'jti-1', 'jti-2', NOW + 100);

      expect(rotated).toBe(true);
      const sql = db._mocks.mockPrepare.mock.calls[0][0];
      // These three conditions are the whole of reuse detection: without the
      // jti guard a replayed token would rotate, and without the expiry guard a
      // dead session would come back to life.
      expect(sql).toContain('WHERE family_id = ? AND jti = ? AND expires_at > ?');
      expect(db._mocks.mockBind).toHaveBeenCalledWith(
        'jti-2',
        'jti-1',
        NOW,
        NOW,
        NOW + 100,
        'family-1',
        'jti-1',
        NOW
      );
    });

    it('reports false when the presented token is not the current one', async () => {
      const db = createMockDb();
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 0 } });

      await expect(rotateSession(db, 'family-1', 'old-jti', 'jti-2', NOW + 100)).resolves.toBe(
        false
      );
    });
  });

  describe('deleteSessionFamily', () => {
    it('deletes by family so every token in the lineage dies at once', async () => {
      const db = createMockDb();

      await expect(deleteSessionFamily(db, 'family-1')).resolves.toBe(true);

      expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
        'DELETE FROM sessions WHERE family_id = ?'
      );
      expect(db._mocks.mockBind).toHaveBeenCalledWith('family-1');
    });

    it('reports false when there was no session to revoke', async () => {
      const db = createMockDb();
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 0 } });

      await expect(deleteSessionFamily(db, 'family-1')).resolves.toBe(false);
    });
  });

  describe('pruneExpiredSessions', () => {
    it('deletes only rows that have already expired, at most a batch at a time', async () => {
      const db = createMockDb();
      db._mocks.mockRun.mockResolvedValue({ success: true, meta: { changes: 3 } });

      const deleted = await pruneExpiredSessions(db, 50);

      expect(deleted).toBe(3);
      const sql = db._mocks.mockPrepare.mock.calls[0][0];
      // expires_at <= now is what makes this safe to run on the hot path: a
      // live session can never match it, whatever the batch size.
      expect(sql).toContain('WHERE expires_at <= ?');
      expect(sql).toContain('LIMIT ?');
      expect(db._mocks.mockBind).toHaveBeenCalledWith(NOW, 50);
    });
  });

  describe('touchSession', () => {
    it('records use without changing which token is current', async () => {
      const db = createMockDb();

      await touchSession(db, 'family-1');

      const sql = db._mocks.mockPrepare.mock.calls[0][0];
      expect(sql).toBe('UPDATE sessions SET last_used_at = ? WHERE family_id = ?');
      expect(sql).not.toContain('jti');
      expect(db._mocks.mockBind).toHaveBeenCalledWith(NOW, 'family-1');
    });
  });
});
