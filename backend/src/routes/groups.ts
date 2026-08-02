import { Hono } from 'hono';
import {
  getUserMemberships,
  getGroupMembers,
  getMembership,
  updateMembershipRole,
  deleteMembership,
  deleteAllUserPushSubscriptionsForGroup,
  deleteAllUserDeviceTokensForGroup,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
  updateMemberImageProtection,
  updateMemberDisplayName,
  getMemberNames,
  isGroupOwner,
  transferGroupOwnership,
  getGroup,
  getGroupExportPhotos,
} from '../lib/db';
import { requireAuth, requireAdmin, requireOwner } from '../middleware/auth';
import {
  updateMemberSchema,
  imageProtectionSchema,
  displayNameSchema,
  transferOwnershipSchema,
} from '../lib/schemas';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  InternalServerError,
  requireParam,
  parseJsonBody,
} from '../lib/http';
import type {
  GroupsListResponse,
  MembersResponse,
  MemberDisplayNameUpdatedResponse,
  PhotoCountResponse,
  GroupDeletedResponse,
  GroupExportResponse,
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
      displayName: m.display_name,
      canonicalName: m.canonical_name,
      email: m.user_email,
      profileColor: m.user_profile_color,
      role: m.role,
      joinedAt: m.joined_at,
      imageProtection: m.image_protection === 1,
    })),
  } satisfies MembersResponse);
});

// Update a member's role (admin only). A member's name is deliberately not
// settable here: users.name is the person's own, tenant-wide, and an admin
// writing it would rename them in every group they belong to. Group-scoped
// renaming lives on the display-name route below.
groups.patch('/:groupId/members/:userId', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const userId = requireParam(c.req.param('userId'), 'userId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'modify members of');

  const { role } = await parseJsonBody(c, updateMemberSchema);

  // Check if membership exists
  const membership = await getMembership(c.env.DB, userId, groupId);
  if (!membership) {
    throw new NotFoundError('User is not a member of this group');
  }

  // Promotion to owner is impossible by construction: the schema only admits
  // 'admin' | 'member' (owner is set at group creation).
  const result = await updateMembershipRole(c.env.DB, userId, groupId, role);
  if (!result.success) {
    if (result.error === 'is_owner') {
      throw new ForbiddenError("Cannot change owner's role");
    }
    throw new InternalServerError('Failed to update role');
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

  // Refused up front, before anything is revoked: the owner keeps both their
  // membership and their notifications.
  if (await isGroupOwner(c.env.DB, userId, groupId)) {
    throw new ForbiddenError('Cannot remove the group owner');
  }

  // Both notification channels have to be revoked, or the removed member's
  // browser/device keeps receiving this group's photos and caption text.
  //
  // Revoked *before* the membership row goes, because D1 gives us no
  // transaction across the two and only this ordering is safe to retry: a
  // failure here leaves a member whose notifications are already gone (they
  // simply re-subscribe), whereas deleting the membership first and then
  // failing would strand the subscription and device-token rows with no way
  // back — the retry 404s on the membership that no longer exists, and the
  // removed member keeps receiving the group's photos.
  await Promise.all([
    deleteAllUserPushSubscriptionsForGroup(c.env.DB, userId, groupId),
    deleteAllUserDeviceTokensForGroup(c.env.DB, userId, groupId),
  ]);

  const result = await deleteMembership(c.env.DB, userId, groupId);
  if (!result.success) {
    // Ownership was checked above; deleteMembership re-checks it against the
    // group row, so this can only mean it changed underneath us.
    if (result.error === 'is_owner') {
      throw new ForbiddenError('Cannot remove the group owner');
    }
    throw new InternalServerError('Failed to remove member');
  }

  return c.json({ message: 'Member removed successfully' });
});

// Leave the current group without revealing its admin-only membership list.
groups.delete('/:groupId/membership', requireAuth, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const currentUser = c.get('user');
  requireCurrentGroup(groupId, currentUser.groupId, 'leave');

  if (await isGroupOwner(c.env.DB, currentUser.id, groupId)) {
    throw new ForbiddenError('Transfer ownership or delete the group before leaving');
  }

  await Promise.all([
    deleteAllUserPushSubscriptionsForGroup(c.env.DB, currentUser.id, groupId),
    deleteAllUserDeviceTokensForGroup(c.env.DB, currentUser.id, groupId),
  ]);
  const result = await deleteMembership(c.env.DB, currentUser.id, groupId);
  if (!result.success) {
    if (result.error === 'is_owner') {
      throw new ForbiddenError('Transfer ownership or delete the group before leaving');
    }
    throw new InternalServerError('Failed to leave group');
  }

  return c.json({ message: 'You have left the group' });
});

groups.post('/:groupId/transfer-ownership', requireOwner, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const currentUser = c.get('user');
  requireCurrentGroup(groupId, currentUser.groupId, 'transfer ownership of');
  const { newOwnerId } = await parseJsonBody(c, transferOwnershipSchema);

  if (newOwnerId === currentUser.id) {
    throw new BadRequestError('Choose another member as the new owner');
  }
  if (!(await getMembership(c.env.DB, newOwnerId, groupId))) {
    throw new NotFoundError('New owner must be a member of this group');
  }
  const transferred = await transferGroupOwnership(c.env.DB, groupId, currentUser.id, newOwnerId);
  if (!transferred) {
    throw new InternalServerError('Failed to transfer ownership');
  }

  return c.json({ message: 'Ownership transferred successfully' });
});

// Set or clear a member's display name for this group (admin of the group, or
// the member themselves). The override is scoped to this group's membership
// row, so it can never reach the user's canonical name or any other group —
// which is what makes it safe for an admin to set on anyone, the owner
// included.
groups.patch('/:groupId/members/:userId/display-name', requireAuth, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  const userId = requireParam(c.req.param('userId'), 'userId');
  const currentUser = c.get('user');
  requireCurrentGroup(groupId, currentUser.groupId, 'modify members of');

  if (currentUser.role !== 'admin' && currentUser.id !== userId) {
    throw new ForbiddenError('You can only change your own display name');
  }

  const membership = await getMembership(c.env.DB, userId, groupId);
  if (!membership) {
    throw new NotFoundError('User is not a member of this group');
  }

  const { displayName } = await parseJsonBody(c, displayNameSchema);

  const updated = await updateMemberDisplayName(c.env.DB, userId, groupId, displayName);
  if (!updated) {
    throw new InternalServerError('Failed to update display name');
  }

  // Re-read rather than assuming: when the override is cleared the effective
  // name is the canonical one, which this route never otherwise reads, and the
  // canonical name may have changed since the caller last loaded the member.
  const names = await getMemberNames(c.env.DB, userId, groupId);
  if (names === null) {
    throw new InternalServerError('Failed to resolve the member name after the update');
  }

  return c.json({
    message: 'Display name updated',
    userId,
    displayName,
    name: names.resolvedName,
    canonicalName: names.canonicalName,
  } satisfies MemberDisplayNameUpdatedResponse);
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

// Admin-only metadata for an export of the converted files currently stored.
groups.get('/:groupId/export', requireAdmin, async (c) => {
  const groupId = requireParam(c.req.param('groupId'), 'groupId');
  requireCurrentGroup(groupId, c.get('user').groupId, 'export');
  const [group, photos] = await Promise.all([
    getGroup(c.env.DB, groupId),
    getGroupExportPhotos(c.env.DB, groupId),
  ]);
  if (!group) throw new NotFoundError('Group not found');

  return c.json({
    groupName: group.name,
    exportedAt: Math.floor(Date.now() / 1000),
    photos: photos.map((photo, index) => {
      const storedExtension = photo.r2_key.split('.').pop()?.toLowerCase();
      const extension =
        storedExtension && ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(storedExtension)
          ? storedExtension
          : 'jpg';
      return {
        id: photo.id,
        caption: photo.caption,
        uploadedAt: photo.uploaded_at,
        uploaderName: photo.uploader_name ?? 'Deleted user',
        fileName: `${String(index + 1).padStart(4, '0')}-${photo.id}.${extension}`,
      };
    }),
  } satisfies GroupExportResponse);
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
