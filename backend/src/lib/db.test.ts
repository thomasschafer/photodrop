import { describe, it, expect, vi } from 'vitest';
import {
  getUserMemberships,
  getMembership,
  createMembership,
  deleteMembership,
  updateMembershipRole,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
} from './db';

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
    return Promise.resolve({ success: true, changes: 1 });
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
    return Promise.resolve({ success: true, changes: 1 });
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
