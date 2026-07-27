import { Hono } from 'hono';
import {
  getUserMemberships,
  getGroupMembers,
  getMembership,
  updateMembershipRole,
  deleteMembership,
  deleteAllUserPushSubscriptionsForGroup,
  deleteAllUserDeviceTokensForGroup,
  updateUserName,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
  updateMemberImageProtection,
} from '../lib/db';
import { requireAuth, requireAdmin, requireOwner } from '../middleware/auth';
import { updateMemberSchema, imageProtectionSchema } from '../lib/schemas';
import {
  NotFoundError,
  ForbiddenError,
  InternalServerError,
  requireParam,
  parseJsonBody,
} from '../lib/http';
import type {
  GroupsListResponse,
  MembersResponse,
  PhotoCountResponse,
  GroupDeletedResponse,
} from '@photodrop/common/apiTypes';
import type { AppEnv } from '../types';

const groups = new Hono<AppEnv>();

// Every route below addresses a group by :groupId; reject requests whose param
// doesn't match the group the caller's token is scoped to.
function requireCurrentGroup(groupId: string, userGroupId: string, action: string): void {
  if (groupId !== userGroupId) {
    throw new ForbiddenError(`Cannot ${action} a different group`);
  }
}

// Get all groups the current user is a member of
groups.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const memberships = await getUserMemberships(c.env.DB, user.id);

  return c.json({
    groups: memberships.map((m) => ({
      id: m.group_id,
      name: m.group_name,
      role: m.role,
      ownerId: m.group_owner_id,
      joinedAt: m.joined_at,
    })),
  } satisfies GroupsListResponse);
});

// Get members of the current group (admin only)
groups.get('/:groupId/members', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'access members of');

  const { members, ownerId } = await getGroupMembers(c.env.DB, groupId);

  return c.json({
    ownerId,
    members: members.map((m) => ({
      userId: m.user_id,
      name: m.user_name,
      email: m.user_email,
      profileColor: m.user_profile_color,
      role: m.role,
      joinedAt: m.joined_at,
      imageProtection: m.image_protection === 1,
    })),
  } satisfies MembersResponse);
});

// Update a member's role, name, or preferences (admin only)
groups.patch('/:groupId/members/:userId', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const userId = requireParam(c.req.param('userId'), 'userId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'modify members of');

  const { role, name } = await parseJsonBody(c, updateMemberSchema);

  // Check if membership exists
  const membership = await getMembership(c.env.DB, userId, groupId);
  if (!membership) {
    throw new NotFoundError('User is not a member of this group');
  }

  // Handle role update. Promotion to owner is impossible by construction: the
  // schema only admits 'admin' | 'member' (owner is set at group creation).
  if (role !== undefined) {
    const result = await updateMembershipRole(c.env.DB, userId, groupId, role);
    if (!result.success) {
      if (result.error === 'is_owner') {
        throw new ForbiddenError("Cannot change owner's role");
      }
      throw new InternalServerError('Failed to update role');
    }
  }

  // Handle name update
  if (name !== undefined) {
    const updated = await updateUserName(c.env.DB, userId, name);
    if (!updated) {
      throw new InternalServerError('Failed to update name');
    }
  }

  return c.json({ message: 'Member updated successfully' });
});

// Remove a member from the group (admin only)
groups.delete('/:groupId/members/:userId', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const userId = requireParam(c.req.param('userId'), 'userId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'modify members of');

  // Check if membership exists
  const exists = await getMembership(c.env.DB, userId, groupId);
  if (!exists) {
    throw new NotFoundError('User is not a member of this group');
  }

  const result = await deleteMembership(c.env.DB, userId, groupId);
  if (!result.success) {
    if (result.error === 'is_owner') {
      throw new ForbiddenError('Cannot remove the group owner');
    }
    throw new InternalServerError('Failed to remove member');
  }

  // Both notification channels have to be revoked, or the removed member's
  // browser/device keeps receiving this group's photos and caption text.
  await Promise.all([
    deleteAllUserPushSubscriptionsForGroup(c.env.DB, userId, groupId),
    deleteAllUserDeviceTokensForGroup(c.env.DB, userId, groupId),
  ]);

  return c.json({ message: 'Member removed successfully' });
});

// Update a member's image protection (admin only)
groups.patch('/:groupId/members/:userId/image-protection', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const userId = requireParam(c.req.param('userId'), 'userId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'modify members of');

  const membership = await getMembership(c.env.DB, userId, groupId);
  if (!membership) {
    throw new NotFoundError('User is not a member of this group');
  }

  const { enabled } = await parseJsonBody(c, imageProtectionSchema);

  const updated = await updateMemberImageProtection(c.env.DB, userId, groupId, enabled);
  if (!updated) {
    throw new InternalServerError('Failed to update image protection');
  }

  return c.json({ message: 'Image protection updated' });
});

// Get photo count for a group (owner only - used for deletion confirmation)
groups.get('/:groupId/photo-count', requireOwner, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'access');

  const count = await getGroupPhotoCount(c.env.DB, groupId);
  return c.json({ count } satisfies PhotoCountResponse);
});

// Delete the entire group (owner only)
groups.delete('/:groupId', requireOwner, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'delete');

  const photoKeys = await getGroupPhotoKeys(c.env.DB, groupId);
  const totalFiles = photoKeys.length + photoKeys.filter((p) => p.thumbnail_r2_key).length;

  // Collect all R2 keys to delete
  const allKeys: string[] = [];
  for (const photo of photoKeys) {
    allKeys.push(photo.r2_key);
    if (photo.thumbnail_r2_key) {
      allKeys.push(photo.thumbnail_r2_key);
    }
  }

  // Delete DB records first, then R2 files. If R2 cleanup fails,
  // we have orphaned files (harmless) rather than DB rows pointing to missing files.
  const success = await deleteGroup(c.env.DB, groupId);
  if (!success) {
    throw new InternalServerError('Failed to delete group from database');
  }

  // Clean up R2 files (best-effort). R2 deletes up to 1000 keys per call, so
  // batching this way costs one subrequest per 1000 files rather than one per
  // file — a group with thousands of photos would otherwise risk exhausting
  // the Worker's subrequest limit midway through cleanup.
  const BATCH_SIZE = 1000;
  let r2FailureCount = 0;

  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batch = allKeys.slice(i, i + BATCH_SIZE);
    try {
      await c.env.PHOTOS.delete(batch);
    } catch (r2Error) {
      // A batch delete is all-or-nothing from our side: we can't tell which
      // keys survived, so count the whole batch as failed.
      console.error('Failed to clean up a batch of R2 files:', r2Error);
      r2FailureCount += batch.length;
    }
  }

  if (r2FailureCount > 0) {
    console.error(
      `Group ${groupId} deleted but ${r2FailureCount}/${totalFiles} R2 files failed to clean up`
    );
  }

  return c.json({
    message: 'Group deleted successfully',
    deletedFiles: totalFiles - r2FailureCount,
  } satisfies GroupDeletedResponse);
});

export default groups;
