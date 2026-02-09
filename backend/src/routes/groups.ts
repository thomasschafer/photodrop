import { Hono } from 'hono';
import {
  getUserMemberships,
  getGroupMembers,
  getMembership,
  updateMembershipRole,
  deleteMembership,
  deleteAllUserPushSubscriptionsForGroup,
  updateUserName,
  getGroupPhotoKeys,
  getGroupPhotoCount,
  deleteGroup,
  updateMemberImageProtection,
} from '../lib/db';
import { requireAuth, requireAdmin, requireOwner } from '../middleware/auth';
import type { AppEnv } from '../types';

const groups = new Hono<AppEnv>();

// Get all groups the current user is a member of
groups.get('/', requireAuth, async (c) => {
  try {
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
    });
  } catch (error) {
    console.error('Error fetching groups:', error);
    return c.json({ error: 'Failed to fetch groups' }, 500);
  }
});

// Get members of the current group (all members can see, emails hidden for non-admins)
groups.get('/:groupId/members', requireAuth, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const user = c.get('user');

    // Ensure the requested group matches the user's current group context
    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot access members of a different group' }, 403);
    }

    const { members, ownerId } = await getGroupMembers(c.env.DB, groupId);

    // Check if the requesting user is an admin (already in the members list)
    const currentMember = members.find((m) => m.user_id === user.id);
    const isAdmin = currentMember?.role === 'admin';

    return c.json({
      ownerId,
      members: members.map((m) => ({
        userId: m.user_id,
        name: m.user_name,
        email: isAdmin ? m.user_email : undefined,
        profileColor: m.user_profile_color,
        role: m.role,
        joinedAt: m.joined_at,
        imageProtection: isAdmin ? m.image_protection === 1 : undefined,
      })),
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    return c.json({ error: 'Failed to fetch members' }, 500);
  }
});

// Update a member's role, name, or preferences (admin only)
groups.patch('/:groupId/members/:userId', requireAdmin, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const userId = c.req.param('userId');
    const user = c.get('user');

    // Ensure the requested group matches the user's current group context
    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot modify members of a different group' }, 403);
    }

    const body = await c.req.json();
    const { role, name } = body;

    // Check if membership exists
    const membership = await getMembership(c.env.DB, userId, groupId);
    if (!membership) {
      return c.json({ error: 'User is not a member of this group' }, 404);
    }

    // Handle role update
    if (role !== undefined) {
      // Cannot promote to owner - owner is set at group creation only
      if (role === 'owner') {
        return c.json({ error: 'Cannot promote to owner' }, 400);
      }

      if (role !== 'admin' && role !== 'member') {
        return c.json({ error: 'Invalid role' }, 400);
      }

      const result = await updateMembershipRole(c.env.DB, userId, groupId, role);
      if (!result.success) {
        if (result.error === 'is_owner') {
          return c.json({ error: "Cannot change owner's role" }, 403);
        }
        return c.json({ error: 'Failed to update role' }, 500);
      }
    }

    // Handle name update
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        return c.json({ error: 'Name cannot be empty' }, 400);
      }
      if (trimmedName.length > 100) {
        return c.json({ error: 'Name is too long' }, 400);
      }

      await updateUserName(c.env.DB, userId, trimmedName);
    }

    return c.json({ message: 'Member updated successfully' });
  } catch (error) {
    console.error('Error updating member:', error);
    return c.json({ error: 'Failed to update member' }, 500);
  }
});

// Remove a member from the group (admin only)
groups.delete('/:groupId/members/:userId', requireAdmin, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const userId = c.req.param('userId');
    const user = c.get('user');

    // Ensure the requested group matches the user's current group context
    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot modify members of a different group' }, 403);
    }

    // Check if membership exists
    const exists = await getMembership(c.env.DB, userId, groupId);
    if (!exists) {
      return c.json({ error: 'User is not a member of this group' }, 404);
    }

    const result = await deleteMembership(c.env.DB, userId, groupId);
    if (!result.success) {
      if (result.error === 'is_owner') {
        return c.json({ error: 'Cannot remove the group owner' }, 403);
      }
      return c.json({ error: 'Failed to remove member' }, 500);
    }

    await deleteAllUserPushSubscriptionsForGroup(c.env.DB, userId, groupId);

    return c.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Error removing member:', error);
    return c.json({ error: 'Failed to remove member' }, 500);
  }
});

// Update a member's image protection (admin only)
groups.patch('/:groupId/members/:userId/image-protection', requireAdmin, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const userId = c.req.param('userId');
    const user = c.get('user');

    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot modify members of a different group' }, 403);
    }

    const membership = await getMembership(c.env.DB, userId, groupId);
    if (!membership) {
      return c.json({ error: 'User is not a member of this group' }, 404);
    }

    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400);
    }

    const success = await updateMemberImageProtection(c.env.DB, userId, groupId, enabled);
    if (!success) {
      return c.json({ error: 'Failed to update image protection' }, 500);
    }

    return c.json({ message: 'Image protection updated' });
  } catch (error) {
    console.error('Error updating image protection:', error);
    return c.json({ error: 'Failed to update image protection' }, 500);
  }
});

// Get photo count for a group (owner only - used for deletion confirmation)
groups.get('/:groupId/photo-count', requireOwner, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const user = c.get('user');

    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot access a different group' }, 403);
    }

    const count = await getGroupPhotoCount(c.env.DB, groupId);
    return c.json({ count });
  } catch (error) {
    console.error('Error getting photo count:', error);
    return c.json({ error: 'Failed to get photo count' }, 500);
  }
});

// Delete the entire group (owner only)
groups.delete('/:groupId', requireOwner, async (c) => {
  try {
    const groupId = c.req.param('groupId');
    const user = c.get('user');

    if (groupId !== user.groupId) {
      return c.json({ error: 'Cannot delete a different group' }, 403);
    }

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

    // Delete R2 files in parallel batches of 50
    const BATCH_SIZE = 50;
    const r2Failures: Array<{ key: string; error: string }> = [];

    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
      const batch = allKeys.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((key) => c.env.PHOTOS.delete(key)));

      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const errorMsg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
          console.error(`Failed to delete R2 key: ${batch[idx]}`, result.reason);
          r2Failures.push({ key: batch[idx], error: errorMsg });
        }
      });
    }

    // If any R2 deletions failed, abort and return error
    if (r2Failures.length > 0) {
      console.error('R2 deletion failures:', r2Failures.slice(0, 10));
      return c.json(
        {
          error: 'Failed to delete some photos from storage',
          details: {
            failedCount: r2Failures.length,
            totalFiles,
            // Note: failure details logged server-side only to avoid leaking internal paths
          },
        },
        500
      );
    }

    // All R2 files deleted successfully, now delete from database
    const success = await deleteGroup(c.env.DB, groupId);
    if (!success) {
      return c.json({ error: 'Failed to delete group from database' }, 500);
    }

    return c.json({
      message: 'Group deleted successfully',
      deletedFiles: totalFiles,
    });
  } catch (error) {
    console.error('Error deleting group:', error);
    return c.json({ error: 'Failed to delete group' }, 500);
  }
});

export default groups;
