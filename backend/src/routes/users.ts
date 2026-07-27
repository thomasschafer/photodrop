import { Hono } from 'hono';
import {
  getUserById,
  getUserMemberships,
  getGroupMembers,
  updateUserProfileColor,
  updateUserName,
} from '../lib/db';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { updateProfileSchema } from '../lib/schemas';
import { NotFoundError, InternalServerError, parseJsonBody } from '../lib/http';
import type {
  UsersListResponse,
  MeResponse,
  ProfileUpdatedResponse,
} from '@photodrop/common/apiTypes';
import type { AppEnv } from '../types';

const users = new Hono<AppEnv>();

users.get('/', requireAdmin, async (c) => {
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
  } satisfies UsersListResponse);
});

users.get('/me', requireAuth, async (c) => {
  const currentUser = c.get('user');
  const user = await getUserById(c.env.DB, currentUser.id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Get all memberships
  const memberships = await getUserMemberships(c.env.DB, user.id);

  // Find current group membership
  const currentMembership = memberships.find((m) => m.group_id === currentUser.groupId);

  return c.json({
    id: user.id,
    name: user.name,
    currentGroupDisplayName: currentMembership?.display_name ?? null,
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
  } satisfies MeResponse);
});

// Update the caller's own profile. `name` here is the canonical name, which
// only its owner may change; per-group display names are set elsewhere and are
// untouched by this route.
users.patch('/me/profile', requireAuth, async (c) => {
  const currentUser = c.get('user');
  // The schema only admits known profile colors, so no separate check is needed.
  const { name, profileColor } = await parseJsonBody(c, updateProfileSchema);

  if (profileColor !== undefined) {
    const updated = await updateUserProfileColor(c.env.DB, currentUser.id, profileColor);
    if (!updated) {
      throw new InternalServerError('Failed to update profile');
    }
  }

  if (name !== undefined) {
    const updated = await updateUserName(c.env.DB, currentUser.id, name);
    if (!updated) {
      throw new InternalServerError('Failed to update profile');
    }
  }

  // Read back rather than echoing the request, so the response reports the
  // stored profile in full even when only one field was sent.
  const user = await getUserById(c.env.DB, currentUser.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  return c.json({
    message: 'Profile updated',
    name: user.name,
    profileColor: user.profile_color,
  } satisfies ProfileUpdatedResponse);
});

export default users;
