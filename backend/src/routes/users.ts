import { Hono } from 'hono';
import {
  getUserById,
  getUserMemberships,
  getGroupMembers,
  updateUserProfile,
  getOwnedGroups,
  createAccountDeletionToken,
  getAccountDeletionToken,
  anonymizeUserAccount,
} from '../lib/db';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { updateProfileSchema, accountDeletionTokenSchema } from '../lib/schemas';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  InternalServerError,
  parseJsonBody,
} from '../lib/http';
import { sendAccountDeletionEmail } from '../lib/email';
import type {
  UsersListResponse,
  MeResponse,
  ProfileUpdatedResponse,
  AccountDeletionRequestedResponse,
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
          displayName: currentMembership.display_name,
        }
      : null,
    groups: memberships.map((m) => ({
      id: m.group_id,
      name: m.group_name,
      role: m.role,
      ownerId: m.group_owner_id,
      imageProtection: m.image_protection === 1,
      displayName: m.display_name,
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

  // One statement for both fields: D1 cannot roll back a second write that
  // fails after the first has landed, and a 500 that had already applied half
  // the request would be a lie. The schema rejects a body with neither field, so
  // there is always something to set.
  const updated = await updateUserProfile(c.env.DB, currentUser.id, { name, profileColor });
  if (!updated) {
    throw new InternalServerError('Failed to update profile');
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

users.post('/me/account-deletion', requireAuth, async (c) => {
  const currentUser = c.get('user');
  const user = await getUserById(c.env.DB, currentUser.id);
  if (!user || typeof user.deleted_at === 'number') throw new NotFoundError('User not found');

  const ownedGroups = await getOwnedGroups(c.env.DB, user.id);
  if (ownedGroups.length > 0) {
    throw new ForbiddenError(
      'Transfer ownership or delete your groups before deleting your account'
    );
  }

  const token = await createAccountDeletionToken(c.env.DB, user.id);
  const confirmationLink = `${c.env.FRONTEND_URL}/delete-account/${token}`;
  await sendAccountDeletionEmail(c.env, user.email, user.name, confirmationLink);

  return c.json({
    message: 'Account deletion email sent',
    email: user.email,
  } satisfies AccountDeletionRequestedResponse);
});

// The emailed token is the fresh proof of identity; this endpoint deliberately
// does not depend on whatever browser session happens to open the link.
users.post('/confirm-account-deletion', async (c) => {
  const { token } = await parseJsonBody(c, accountDeletionTokenSchema);
  const confirmation = await getAccountDeletionToken(c.env.DB, token);
  const now = Math.floor(Date.now() / 1000);
  if (!confirmation || confirmation.used_at !== null || confirmation.expires_at < now) {
    throw new BadRequestError('This account deletion link is invalid or has expired');
  }

  const user = await getUserById(c.env.DB, confirmation.user_id);
  if (!user || typeof user.deleted_at === 'number') {
    throw new BadRequestError('This account has already been deleted');
  }
  if ((await getOwnedGroups(c.env.DB, user.id)).length > 0) {
    throw new ForbiddenError(
      'Transfer ownership or delete your groups before deleting your account'
    );
  }

  const deleted = await anonymizeUserAccount(c.env.DB, user, token);
  if (!deleted) throw new InternalServerError('Failed to delete account');

  return c.json({ message: 'Account deleted successfully' });
});

export default users;
