import { describe, it, expect, vi } from 'vitest';
import {
  getUserMemberships,
  getMembership,
  createMembership,
  deleteMembership,
  updateMembershipRole,
  countGroupAdmins,
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
        },
        {
          user_id: 'user-1',
          group_id: 'group-2',
          role: 'member',
          joined_at: 2000,
          group_name: 'Work Team',
        },
      ];
      const db = createMockDb(memberships);

      const result = await getUserMemberships(db, 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].group_name).toBe('Family Photos');
      expect(result[0].role).toBe('admin');
      expect(result[1].group_name).toBe('Work Team');
      expect(result[1].role).toBe('member');
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
    it('removes membership and returns true', async () => {
      const db = createMockDb([]);

      const result = await deleteMembership(db, 'user-1', 'group-1');

      expect(result).toBe(true);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('user-1', 'group-1');
      expect(db._mocks.mockRun).toHaveBeenCalled();
    });
  });

  describe('updateMembershipRole', () => {
    it('updates role from member to admin', async () => {
      const db = createMockDb([]);

      const result = await updateMembershipRole(db, 'user-1', 'group-1', 'admin');

      expect(result).toBe(true);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('admin', 'user-1', 'group-1');
    });

    it('updates role from admin to member', async () => {
      const db = createMockDb([]);

      const result = await updateMembershipRole(db, 'user-1', 'group-1', 'member');

      expect(result).toBe(true);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('member', 'user-1', 'group-1');
    });
  });

  describe('countGroupAdmins', () => {
    it('returns correct admin count', async () => {
      const db = createMockDb([{ count: 3 }]);

      const result = await countGroupAdmins(db, 'group-1');

      expect(result).toBe(3);
      expect(db._mocks.mockBind).toHaveBeenCalledWith('group-1', 'admin');
    });

    it('returns 0 when no admins exist', async () => {
      const db = createMockDb([null]);

      const result = await countGroupAdmins(db, 'group-empty');

      expect(result).toBe(0);
    });
  });
});
