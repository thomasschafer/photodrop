import { Hono } from 'hono';
import { ZodError } from 'zod';
import {
  getUserById,
  getUserMemberships,
  getGroupMembers,
  updateUserProfileColor,
  isProfileColor,
} from '../lib/db';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { updateProfileSchema } from '../lib/schemas';
import type { AppEnv } from '../types';

const users = new Hono<AppEnv>();

users.get('/', requireAdmin, async (c) => {
  try {
    const currentUser = c.get('user');
    const { members } = await getGroupMembers(c.env.DB, currentUser.groupId);

    return c.json({
      users: members.map((m) => ({
        id: m.user_id,
        name: m.user_name,
        email: m.user_email,
        profileColor: m.user_profile_color,
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

    // Get all memberships
    const memberships = await getUserMemberships(c.env.DB, user.id);

    // Find current group membership
    const currentMembership = memberships.find((m) => m.group_id === currentUser.groupId);

    return c.json({
      id: user.id,
      name: user.name,
      email: user.email,
      profileColor: user.profile_color,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      currentGroup: currentMembership
        ? {
            id: currentUser.groupId,
            name: currentMembership.group_name,
            role: currentMembership.role,
            ownerId: currentMembership.group_owner_id,
            imageProtection: currentMembership.image_protection === 1,
          }
        : null,
      groups: memberships.map((m) => ({
        id: m.group_id,
        name: m.group_name,
        role: m.role,
        ownerId: m.group_owner_id,
        imageProtection: m.image_protection === 1,
      })),
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

users.patch('/me/profile', requireAuth, async (c) => {
  try {
    const currentUser = c.get('user');
    const body = await c.req.json();
    const { profileColor } = updateProfileSchema.parse(body);

    if (!isProfileColor(profileColor)) {
      return c.json({ error: 'Invalid profile color' }, 400);
    }

    const success = await updateUserProfileColor(c.env.DB, currentUser.id, profileColor);

    if (!success) {
      return c.json({ error: 'Failed to update profile' }, 500);
    }

    return c.json({ message: 'Profile updated', profileColor });
  } catch (error) {
    if (error instanceof ZodError) {
      throw error;
    }

    console.error('Error updating profile:', error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

export default users;
