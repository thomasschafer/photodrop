import { Hono } from 'hono';
import { getUserById, getMembership, getUserMemberships, getGroupMembers } from '../lib/db';
import { requireAuth } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
};

type Variables = {
  user: {
    id: string;
    groupId: string;
    role: 'admin' | 'member';
  };
};

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

users.get('/', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const members = await getGroupMembers(c.env.DB, currentUser.groupId);

    return c.json({
      users: members.map((m) => ({
        id: m.user_id,
        name: m.user_name,
        email: m.user_email,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

users.get('/me', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const user = await getUserById(c.env.DB, currentUser.id);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get membership for current group context
    const membership = await getMembership(c.env.DB, user.id, currentUser.groupId);

    // Get all memberships
    const memberships = await getUserMemberships(c.env.DB, user.id);

    return c.json({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      currentGroup: membership
        ? {
            id: currentUser.groupId,
            role: membership.role,
          }
        : null,
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
      })),
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

export default users;
