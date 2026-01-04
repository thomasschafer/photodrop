import { describe, it, expect } from 'vitest';
import {
  createInvite,
  getUserByInviteToken,
  acceptInvite,
  isFirstUserInSystem,
  getAllUsers,
  updateUserRole,
  countAdmins,
} from './db';

const createMockDB = () => {
  const storage = new Map<string, any>();

  const mockDB = {
    prepare: (query: string) => {
      let bindings: any[] = [];

      const boundQuery = {
        run: async () => {
          if (query.includes('INSERT INTO users')) {
            const id = bindings[0];
            const name = bindings[1];
            const phoneOrRole = bindings[2];

            let user: any;
            if (query.includes('phone')) {
              user = {
                id,
                name,
                phone: phoneOrRole,
                role: 'viewer',
                invite_token: bindings[3],
                invite_role: bindings[4],
                invite_accepted_at: null,
                created_at: bindings[5],
                last_seen_at: null,
              };
            } else {
              user = {
                id,
                name,
                phone: null,
                role: 'viewer',
                invite_token: phoneOrRole,
                invite_role: bindings[3],
                invite_accepted_at: null,
                created_at: bindings[4],
                last_seen_at: null,
              };
            }
            storage.set(id, user);
            return { success: true };
          }

          if (query.includes('UPDATE users') && query.includes('invite_accepted_at')) {
            const userId = bindings[2];
            const user = storage.get(userId);
            if (user) {
              user.invite_accepted_at = bindings[0];
              user.role = bindings[1];
              user.invite_token = null;
              storage.set(userId, user);
            }
            return { success: true };
          }

          if (query.includes('UPDATE users') && query.includes('role')) {
            const userId = bindings[1];
            const user = storage.get(userId);
            if (user) {
              user.role = bindings[0];
              storage.set(userId, user);
            }
            return { success: true };
          }

          if (query.includes('DELETE FROM users')) {
            const userId = bindings[0];
            storage.delete(userId);
            return { success: true };
          }

          return { success: true };
        },
        first: async () => {
          if (query.includes('WHERE invite_token')) {
            const inviteToken = bindings[0];
            for (const user of storage.values()) {
              if (user.invite_token === inviteToken) {
                return user;
              }
            }
            return null;
          }

          if (query.includes('WHERE id = ?')) {
            const userId = bindings[0];
            return storage.get(userId) || null;
          }

          if (query.includes('COUNT(*)') && query.includes('invite_accepted_at IS NOT NULL')) {
            let count = 0;
            for (const user of storage.values()) {
              if (user.invite_accepted_at !== null) {
                if (query.includes('role = ?')) {
                  if (user.role === bindings[0]) count++;
                } else {
                  count++;
                }
              }
            }
            return { count };
          }

          return null;
        },
        all: async () => {
          const users = Array.from(storage.values()).filter(
            (u) => u.invite_accepted_at !== null
          );
          return { results: users };
        },
      };

      return {
        bind: (...args: any[]) => {
          bindings = args;
          return boundQuery;
        },
        // Allow calling .first() and .all() directly without .bind()
        ...boundQuery,
      };
    },
  } as unknown as D1Database;

  return { db: mockDB, storage };
};

describe('Database functions', () => {
  describe('createInvite', () => {
    it('should create an invite with required fields', async () => {
      const { db } = createMockDB();
      const result = await createInvite(db, 'John Doe', 'viewer');

      expect(result.userId).toBeTruthy();
      expect(result.inviteToken).toBeTruthy();
      expect(result.userId).toHaveLength(32);
      expect(result.inviteToken).toHaveLength(64);
    });

    it('should create an invite with phone number', async () => {
      const { db } = createMockDB();
      const result = await createInvite(db, 'John Doe', 'viewer', '+1234567890');

      expect(result.userId).toBeTruthy();
      expect(result.inviteToken).toBeTruthy();
    });

    it('should create admin invite', async () => {
      const { db } = createMockDB();
      const result = await createInvite(db, 'Admin User', 'admin');

      const user = await getUserByInviteToken(db, result.inviteToken);
      expect(user?.invite_role).toBe('admin');
    });
  });

  describe('getUserByInviteToken', () => {
    it('should return user when invite token exists', async () => {
      const { db } = createMockDB();
      const { inviteToken } = await createInvite(db, 'John Doe');

      const user = await getUserByInviteToken(db, inviteToken);
      expect(user).toBeTruthy();
      expect(user?.name).toBe('John Doe');
    });

    it('should return null when invite token does not exist', async () => {
      const { db } = createMockDB();
      const user = await getUserByInviteToken(db, 'nonexistent-token');
      expect(user).toBeNull();
    });
  });

  describe('acceptInvite', () => {
    it('should accept invite and update user', async () => {
      const { db } = createMockDB();
      const { inviteToken, userId } = await createInvite(db, 'John Doe', 'viewer');

      const user = await acceptInvite(db, inviteToken);
      expect(user).toBeTruthy();
      expect(user?.id).toBe(userId);
      expect(user?.invite_accepted_at).toBeTruthy();
      expect(user?.invite_token).toBeNull();
    });

    it('should make first user an admin regardless of invite role', async () => {
      const { db } = createMockDB();
      const { inviteToken } = await createInvite(db, 'First User', 'viewer');

      const user = await acceptInvite(db, inviteToken);
      expect(user?.role).toBe('admin');
    });

    it('should respect invite role for non-first users', async () => {
      const { db } = createMockDB();
      const { inviteToken: firstToken } = await createInvite(db, 'First User', 'viewer');
      await acceptInvite(db, firstToken);

      const { inviteToken: secondToken } = await createInvite(db, 'Second User', 'viewer');
      const secondUser = await acceptInvite(db, secondToken);

      expect(secondUser?.role).toBe('viewer');
    });

    it('should not accept already accepted invite', async () => {
      const { db } = createMockDB();
      const { inviteToken } = await createInvite(db, 'John Doe');

      await acceptInvite(db, inviteToken);
      const result = await acceptInvite(db, inviteToken);

      expect(result).toBeNull();
    });
  });

  describe('isFirstUserInSystem', () => {
    it('should return true when no users have accepted invites', async () => {
      const { db } = createMockDB();
      const result = await isFirstUserInSystem(db);
      expect(result).toBe(true);
    });

    it('should return false when users have accepted invites', async () => {
      const { db } = createMockDB();
      const { inviteToken } = await createInvite(db, 'John Doe');
      await acceptInvite(db, inviteToken);

      const result = await isFirstUserInSystem(db);
      expect(result).toBe(false);
    });
  });

  describe('getAllUsers', () => {
    it('should return only accepted users', async () => {
      const { db } = createMockDB();

      const { inviteToken: token1 } = await createInvite(db, 'User 1');
      await acceptInvite(db, token1);

      await createInvite(db, 'User 2'); // Not accepted

      const { inviteToken: token3 } = await createInvite(db, 'User 3');
      await acceptInvite(db, token3);

      const users = await getAllUsers(db);
      expect(users).toHaveLength(2);
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      const { db } = createMockDB();
      const { inviteToken, userId } = await createInvite(db, 'User 1', 'viewer');
      await acceptInvite(db, inviteToken);

      const result = await updateUserRole(db, userId, 'admin');
      expect(result).toBe(true);
    });
  });

  describe('countAdmins', () => {
    it('should count only accepted admin users', async () => {
      const { db } = createMockDB();

      const { inviteToken: token1 } = await createInvite(db, 'Admin 1', 'admin');
      await acceptInvite(db, token1);

      const { inviteToken: token2 } = await createInvite(db, 'Viewer 1', 'viewer');
      await acceptInvite(db, token2);

      await createInvite(db, 'Admin 2', 'admin'); // Not accepted

      const count = await countAdmins(db);
      expect(count).toBe(1);
    });
  });
});
