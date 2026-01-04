import { Hono } from 'hono';
import { getAllUsers, getUserById, updateUserRole, deleteUser, countAdmins } from '../lib/db';
import { requireAuth, requireAdmin } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
};

const users = new Hono<{ Bindings: Bindings }>();

users.get('/me', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const user = await getUserById(c.env.DB, currentUser.id);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

users.get('/', requireAdmin, async (c) => {
  try {
    const allUsers = await getAllUsers(c.env.DB);

    return c.json({
      users: allUsers.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

users.patch('/:id/role', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');
    const body = await c.req.json();
    const { role } = body;

    if (!role || (role !== 'admin' && role !== 'viewer')) {
      return c.json({ error: 'Valid role is required (admin or viewer)' }, 400);
    }

    const user = await getUserById(c.env.DB, userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    if (user.role === 'admin' && role === 'viewer') {
      const adminCount = await countAdmins(c.env.DB);
      if (adminCount <= 1) {
        return c.json({ error: 'Cannot demote the last admin' }, 400);
      }
    }

    const currentUser = c.get('user');
    if (currentUser.id === userId && role === 'viewer') {
      return c.json({ error: 'Cannot demote yourself' }, 400);
    }

    await updateUserRole(c.env.DB, userId, role);

    const updatedUser = await getUserById(c.env.DB, userId);

    return c.json({
      id: updatedUser!.id,
      name: updatedUser!.name,
      role: updatedUser!.role,
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    return c.json({ error: 'Failed to update user role' }, 500);
  }
});

users.delete('/:id', requireAdmin, async (c) => {
  try {
    const userId = c.req.param('id');

    const user = await getUserById(c.env.DB, userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const currentUser = c.get('user');
    if (currentUser.id === userId) {
      return c.json({ error: 'Cannot delete yourself' }, 400);
    }

    if (user.role === 'admin') {
      const adminCount = await countAdmins(c.env.DB);
      if (adminCount <= 1) {
        return c.json({ error: 'Cannot delete the last admin' }, 400);
      }
    }

    await deleteUser(c.env.DB, userId);

    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
});

export default users;
