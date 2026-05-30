import { generateId, generateInviteToken } from './crypto';

// Keep in sync with frontend/src/lib/profileColors.ts
export const PROFILE_COLORS = [
  'terracotta',
  'coral',
  'amber',
  'rust',
  'clay',
  'copper',
  'sienna',
  'sage',
  'olive',
  'forest',
  'moss',
  'jade',
  'slate',
  'ocean',
  'teal',
  'indigo',
  'plum',
  'wine',
  'mauve',
  'rose',
] as const;

export type ProfileColor = (typeof PROFILE_COLORS)[number];

export function isProfileColor(value: string): value is ProfileColor {
  return (PROFILE_COLORS as readonly string[]).includes(value);
}

export function getRandomProfileColor(): ProfileColor {
  return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
}

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  profile_color: ProfileColor;
  created_at: number;
  last_seen_at: number | null;
}

export type MembershipRole = 'admin' | 'member';

export interface Membership {
  user_id: string;
  group_id: string;
  role: MembershipRole;
  joined_at: number;
  image_protection: number;
}

export interface MembershipWithGroup extends Membership {
  group_name: string;
  group_owner_id: string;
}

export interface MembershipWithUser extends Membership {
  user_name: string;
  user_email: string;
  user_profile_color: ProfileColor;
}

export interface MagicLinkToken {
  token: string;
  group_id: string | null;
  email: string;
  type: 'invite' | 'login';
  invite_role: MembershipRole | null; // 'admin' or 'member' only
  created_at: number;
  expires_at: number;
  used_at: number | null;
  pending_at: number | null;
}

export interface Photo {
  id: string;
  group_id: string;
  r2_key: string;
  caption: string | null;
  uploaded_by: string;
  uploaded_at: number;
  thumbnail_r2_key: string | null;
}

export interface PhotoView {
  photo_id: string;
  user_id: string;
  viewed_at: number;
}

export interface PhotoReaction {
  photo_id: string;
  user_id: string;
  emoji: string;
  created_at: number;
}

export interface PhotoReactionWithUser extends PhotoReaction {
  user_name: string;
  user_profile_color: ProfileColor;
}

export interface Comment {
  id: string;
  photo_id: string;
  user_id: string | null;
  author_name: string;
  user_name?: string | null;
  author_profile_color: ProfileColor | null;
  content: string;
  created_at: number;
  deleted_at: number | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface PhotoWithCounts extends Photo {
  comment_count: number;
  reactions: ReactionSummary[];
  user_reaction: string | null;
}

// Group functions
export async function createGroup(db: D1Database, name: string, ownerId: string): Promise<string> {
  const groupId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO groups (id, name, owner_id, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(groupId, name, ownerId, now)
    .run();

  return groupId;
}

export async function getGroup(db: D1Database, groupId: string): Promise<Group | null> {
  const result = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<Group>();

  return result;
}

export async function updateMemberImageProtection(
  db: D1Database,
  userId: string,
  groupId: string,
  enabled: boolean
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE memberships SET image_protection = ? WHERE user_id = ? AND group_id = ?')
    .bind(enabled ? 1 : 0, userId, groupId)
    .run();
  return result.success;
}

// User functions
export async function createUser(db: D1Database, name: string, email: string): Promise<string> {
  const userId = generateId();
  const now = Math.floor(Date.now() / 1000);
  const profileColor = getRandomProfileColor();
  const normalizedEmail = email.toLowerCase().trim();

  await db
    .prepare(
      `INSERT INTO users (id, name, email, profile_color, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(userId, name, normalizedEmail, profileColor, now)
    .run();

  return userId;
}

// Membership functions
export async function createMembership(
  db: D1Database,
  userId: string,
  groupId: string,
  role: MembershipRole
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO memberships (user_id, group_id, role, joined_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, groupId, role, now)
    .run();
}

export async function getMembership(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<Membership | null> {
  const result = await db
    .prepare('SELECT * FROM memberships WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .first<Membership>();

  return result;
}

export async function getUserMemberships(
  db: D1Database,
  userId: string
): Promise<MembershipWithGroup[]> {
  const result = await db
    .prepare(
      `SELECT m.user_id, m.group_id, m.role, m.joined_at, m.image_protection, g.name as group_name, g.owner_id as group_owner_id
       FROM memberships m
       JOIN groups g ON m.group_id = g.id
       WHERE m.user_id = ?
       ORDER BY m.joined_at DESC`
    )
    .bind(userId)
    .all<MembershipWithGroup>();

  return result.results || [];
}

export async function getGroupMembers(
  db: D1Database,
  groupId: string
): Promise<{ members: MembershipWithUser[]; ownerId: string | null }> {
  const [membersResult, group] = await Promise.all([
    db
      .prepare(
        `SELECT m.user_id, m.group_id, m.role, m.joined_at, m.image_protection, u.name as user_name, u.email as user_email, u.profile_color as user_profile_color
         FROM memberships m
         JOIN users u ON m.user_id = u.id
         WHERE m.group_id = ?
         ORDER BY m.joined_at ASC`
      )
      .bind(groupId)
      .all<MembershipWithUser>(),
    getGroup(db, groupId),
  ]);

  return {
    members: membersResult.results || [],
    ownerId: group?.owner_id ?? null,
  };
}

export async function updateMembershipRole(
  db: D1Database,
  userId: string,
  groupId: string,
  role: 'admin' | 'member'
): Promise<{ success: boolean; error?: 'is_owner' }> {
  // Check if the user is the group owner - owners' roles cannot be changed
  const group = await getGroup(db, groupId);
  if (group?.owner_id === userId) {
    return { success: false, error: 'is_owner' };
  }

  const result = await db
    .prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND group_id = ?')
    .bind(role, userId, groupId)
    .run();

  return { success: result.success };
}

export async function deleteMembership(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<{ success: boolean; error?: 'is_owner' }> {
  // Check if the user is the group owner - owners cannot be removed
  const group = await getGroup(db, groupId);
  if (group?.owner_id === userId) {
    return { success: false, error: 'is_owner' };
  }

  const result = await db
    .prepare('DELETE FROM memberships WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .run();

  return { success: result.success };
}

export async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();

  return result;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(normalizedEmail)
    .first<User>();

  return result;
}

export async function updateUserLastSeen(db: D1Database, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, userId).run();
}

export async function updateUserName(
  db: D1Database,
  userId: string,
  name: string
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE users SET name = ? WHERE id = ?')
    .bind(name, userId)
    .run();

  return result.success;
}

export async function updateUserProfileColor(
  db: D1Database,
  userId: string,
  color: ProfileColor
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE users SET profile_color = ? WHERE id = ?')
    .bind(color, userId)
    .run();

  return result.success;
}

// Magic link token functions
export async function createMagicLinkToken(
  db: D1Database,
  groupId: string | null,
  email: string,
  type: 'invite' | 'login',
  inviteRole?: 'admin' | 'member'
): Promise<string> {
  if (type === 'invite' && !groupId) {
    throw new Error('Invite magic links require a group_id');
  }

  const token = generateInviteToken(); // Reuse this for cryptographically random tokens
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 15 * 60; // 15 minutes

  const normalizedEmail = email.toLowerCase().trim();

  await db
    .prepare(
      `INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(token, groupId, normalizedEmail, type, inviteRole || null, now, expiresAt)
    .run();

  return token;
}

export async function getMagicLinkToken(
  db: D1Database,
  token: string
): Promise<MagicLinkToken | null> {
  const result = await db
    .prepare('SELECT * FROM magic_link_tokens WHERE token = ?')
    .bind(token)
    .first<MagicLinkToken>();

  return result;
}

export async function markMagicLinkTokenUsed(db: D1Database, token: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token = ?')
    .bind(now, token)
    .run();
}

/**
 * Mark a token as pending (verification in progress).
 * Returns false if the token is already pending within the timeout window.
 * Uses atomic conditional update to prevent race conditions.
 */
export async function markMagicLinkTokenPending(
  db: D1Database,
  token: string,
  pendingTimeoutSeconds: number = 300 // 5 minutes
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - pendingTimeoutSeconds;

  // Atomic conditional update: only succeeds if not already pending (or pending expired)
  const result = await db
    .prepare(
      `UPDATE magic_link_tokens
       SET pending_at = ?
       WHERE token = ?
         AND used_at IS NULL
         AND (pending_at IS NULL OR pending_at <= ?)`
    )
    .bind(now, token, cutoff)
    .run();

  // If no rows updated, token is already pending, used, or doesn't exist
  return result.meta.changes > 0;
}

export async function createPhoto(
  db: D1Database,
  groupId: string,
  r2Key: string,
  thumbnailR2Key: string,
  uploadedBy: string,
  caption?: string
): Promise<string> {
  const photoId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO photos (id, group_id, r2_key, thumbnail_r2_key, caption, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(photoId, groupId, r2Key, thumbnailR2Key, caption || null, uploadedBy, now)
    .run();

  return photoId;
}

export async function getPhoto(
  db: D1Database,
  photoId: string,
  groupId: string
): Promise<Photo | null> {
  // Ensure photo belongs to the group
  const result = await db
    .prepare('SELECT * FROM photos WHERE id = ? AND group_id = ?')
    .bind(photoId, groupId)
    .first<Photo>();

  return result;
}

export async function listPhotos(
  db: D1Database,
  groupId: string,
  limit: number = 20,
  offset: number = 0
): Promise<Photo[]> {
  const result = await db
    .prepare('SELECT * FROM photos WHERE group_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?')
    .bind(groupId, limit, offset)
    .all<Photo>();

  return result.results || [];
}

export async function deletePhoto(
  db: D1Database,
  photoId: string,
  groupId: string
): Promise<boolean> {
  // Ensure photo belongs to the group before deleting
  const result = await db
    .prepare('DELETE FROM photos WHERE id = ? AND group_id = ?')
    .bind(photoId, groupId)
    .run();

  return result.success;
}

export async function recordPhotoView(
  db: D1Database,
  photoId: string,
  userId: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO photo_views (photo_id, user_id, viewed_at)
       VALUES (?, ?, ?)
       ON CONFLICT (photo_id, user_id) DO UPDATE SET viewed_at = ?`
    )
    .bind(photoId, userId, now, now)
    .run();
}

export async function getPhotoViewers(
  db: D1Database,
  photoId: string
): Promise<Array<{ userId: string; viewedAt: number }>> {
  const result = await db
    .prepare(
      `SELECT user_id as userId, viewed_at as viewedAt
       FROM photo_views
       WHERE photo_id = ?
       ORDER BY viewed_at DESC`
    )
    .bind(photoId)
    .all<{ userId: string; viewedAt: number }>();

  return result.results || [];
}

export async function addPhotoReaction(
  db: D1Database,
  photoId: string,
  userId: string,
  emoji: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO photo_reactions (photo_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (photo_id, user_id) DO UPDATE SET emoji = ?, created_at = ?`
    )
    .bind(photoId, userId, emoji, now, emoji, now)
    .run();
}

export async function removePhotoReaction(
  db: D1Database,
  photoId: string,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM photo_reactions WHERE photo_id = ? AND user_id = ?')
    .bind(photoId, userId)
    .run();
}

export async function getPhotoReactions(db: D1Database, photoId: string): Promise<PhotoReaction[]> {
  const result = await db
    .prepare(
      `SELECT photo_id, user_id, emoji, created_at
       FROM photo_reactions
       WHERE photo_id = ?
       ORDER BY created_at ASC`
    )
    .bind(photoId)
    .all<PhotoReaction>();

  return result.results || [];
}

export async function getGroupPhotoKeys(
  db: D1Database,
  groupId: string
): Promise<Array<{ r2_key: string; thumbnail_r2_key: string | null }>> {
  const result = await db
    .prepare('SELECT r2_key, thumbnail_r2_key FROM photos WHERE group_id = ?')
    .bind(groupId)
    .all<{ r2_key: string; thumbnail_r2_key: string | null }>();

  return result.results || [];
}

export async function getGroupPhotoCount(db: D1Database, groupId: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM photos WHERE group_id = ?')
    .bind(groupId)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

export async function deleteGroup(db: D1Database, groupId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run();

  return result.success;
}

// Push subscription types and functions
export interface PushSubscription {
  id: string;
  user_id: string;
  group_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deletion_token: string;
  created_at: number;
}

export async function createPushSubscription(
  db: D1Database,
  userId: string,
  groupId: string,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<{ id: string; deletionToken: string }> {
  const id = generateId();
  const deletionToken = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, group_id, endpoint, p256dh, auth, deletion_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint, group_id) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         deletion_token = excluded.deletion_token`
    )
    .bind(id, userId, groupId, endpoint, p256dh, auth, deletionToken, now)
    .run();

  return { id, deletionToken };
}

export async function getPushSubscription(
  db: D1Database,
  userId: string,
  groupId: string,
  endpoint: string
): Promise<PushSubscription | null> {
  const result = await db
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND group_id = ? AND endpoint = ?')
    .bind(userId, groupId, endpoint)
    .first<PushSubscription>();

  return result;
}

export async function getPushSubscriptionByEndpoint(
  db: D1Database,
  endpoint: string
): Promise<PushSubscription | null> {
  const result = await db
    .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .first<PushSubscription>();

  return result;
}

export async function getUserPushSubscriptionsForGroup(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<PushSubscription[]> {
  const result = await db
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .all<PushSubscription>();

  return result.results || [];
}

export async function getGroupPushSubscriptions(
  db: D1Database,
  groupId: string,
  excludeUserId?: string
): Promise<PushSubscription[]> {
  if (excludeUserId) {
    const result = await db
      .prepare('SELECT * FROM push_subscriptions WHERE group_id = ? AND user_id != ?')
      .bind(groupId, excludeUserId)
      .all<PushSubscription>();
    return result.results || [];
  }

  const result = await db
    .prepare('SELECT * FROM push_subscriptions WHERE group_id = ?')
    .bind(groupId)
    .all<PushSubscription>();

  return result.results || [];
}

export async function deletePushSubscription(db: D1Database, endpoint: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .run();

  return result.success;
}

/**
 * Deletes ALL push subscriptions for an endpoint if the provided token matches
 * any subscription for that endpoint. Used during logout to clean up all
 * subscriptions from the current browser - the token proves ownership of
 * the endpoint without requiring authentication.
 */
export async function deleteAllPushSubscriptionsForEndpointWithToken(
  db: D1Database,
  endpoint: string,
  deletionToken: string
): Promise<{ success: boolean; tokenValid: boolean }> {
  const subscription = await db
    .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? AND deletion_token = ?')
    .bind(endpoint, deletionToken)
    .first();

  if (!subscription) {
    return { success: false, tokenValid: false };
  }

  const result = await db
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .run();

  return { success: result.success, tokenValid: true };
}

export async function deletePushSubscriptionForGroup(
  db: D1Database,
  userId: string,
  groupId: string,
  endpoint: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND group_id = ? AND endpoint = ?')
    .bind(userId, groupId, endpoint)
    .run();

  return result.success;
}

export async function deleteAllUserPushSubscriptionsForGroup(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .run();

  return result.success;
}

// Device token types and functions (native push notifications)
export type DevicePlatform = 'ios' | 'android';

export interface DeviceToken {
  id: string;
  user_id: string;
  group_id: string;
  platform: DevicePlatform;
  token: string;
  created_at: number;
}

export async function createDeviceToken(
  db: D1Database,
  userId: string,
  groupId: string,
  platform: DevicePlatform,
  token: string
): Promise<string> {
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  // Note: created_at is NOT updated on conflict - it reflects first registration
  // This allows rate limiting based on new token creation time
  await db
    .prepare(
      `INSERT INTO device_tokens (id, user_id, group_id, platform, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, group_id, token) DO UPDATE SET
         platform = excluded.platform`
    )
    .bind(id, userId, groupId, platform, token, now)
    .run();

  return id;
}

/**
 * Count device tokens created by a user since a given timestamp.
 * Used for rate limiting new device registrations.
 */
export async function countUserDeviceTokensSince(
  db: D1Database,
  userId: string,
  sinceTimestamp: number
): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM device_tokens WHERE user_id = ? AND created_at >= ?')
    .bind(userId, sinceTimestamp)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

export async function getDeviceToken(
  db: D1Database,
  userId: string,
  groupId: string,
  token: string
): Promise<DeviceToken | null> {
  const result = await db
    .prepare('SELECT * FROM device_tokens WHERE user_id = ? AND group_id = ? AND token = ?')
    .bind(userId, groupId, token)
    .first<DeviceToken>();

  return result;
}

export async function getGroupDeviceTokens(
  db: D1Database,
  groupId: string,
  excludeUserId?: string
): Promise<DeviceToken[]> {
  if (excludeUserId) {
    const result = await db
      .prepare('SELECT * FROM device_tokens WHERE group_id = ? AND user_id != ?')
      .bind(groupId, excludeUserId)
      .all<DeviceToken>();
    return result.results || [];
  }

  const result = await db
    .prepare('SELECT * FROM device_tokens WHERE group_id = ?')
    .bind(groupId)
    .all<DeviceToken>();

  return result.results || [];
}

export async function deleteDeviceToken(
  db: D1Database,
  userId: string,
  groupId: string,
  token: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM device_tokens WHERE user_id = ? AND group_id = ? AND token = ?')
    .bind(userId, groupId, token)
    .run();

  return result.success;
}

export async function deleteAllUserDeviceTokens(db: D1Database, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM device_tokens WHERE user_id = ?').bind(userId).run();

  return result.success;
}

export async function deleteDeviceTokenByToken(db: D1Database, token: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();

  return result.success;
}

// Comment functions
export async function createComment(
  db: D1Database,
  photoId: string,
  userId: string,
  authorName: string,
  content: string
): Promise<string> {
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO comments (id, photo_id, user_id, author_name, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, photoId, userId, authorName, content, now)
    .run();

  return id;
}

export async function getCommentsByPhotoId(db: D1Database, photoId: string): Promise<Comment[]> {
  const result = await db
    .prepare(
      `SELECT c.id, c.photo_id, c.user_id, c.author_name, u.name as user_name, u.profile_color as author_profile_color, c.content, c.created_at, c.deleted_at
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.photo_id = ?
       ORDER BY c.created_at DESC`
    )
    .bind(photoId)
    .all<Comment>();

  return result.results || [];
}

export async function getComment(db: D1Database, commentId: string): Promise<Comment | null> {
  const result = await db
    .prepare('SELECT * FROM comments WHERE id = ?')
    .bind(commentId)
    .first<Comment>();

  return result;
}

export async function deleteComment(db: D1Database, commentId: string): Promise<boolean> {
  // Soft-delete: null out user_id, author_name, and content but keep the row
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      "UPDATE comments SET user_id = NULL, author_name = '[deleted]', content = '[deleted]', deleted_at = ? WHERE id = ?"
    )
    .bind(now, commentId)
    .run();

  return result.success;
}

// Reaction functions with user details
export async function getPhotoReactionsWithUsers(
  db: D1Database,
  photoId: string
): Promise<PhotoReactionWithUser[]> {
  const result = await db
    .prepare(
      `SELECT pr.photo_id, pr.user_id, pr.emoji, pr.created_at, u.name as user_name, u.profile_color as user_profile_color
       FROM photo_reactions pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.photo_id = ?
       ORDER BY pr.created_at ASC`
    )
    .bind(photoId)
    .all<PhotoReactionWithUser>();

  return result.results || [];
}

// Internal type for the aggregated query result
interface PhotoWithCountsRow extends Photo {
  comment_count: number;
  user_reaction: string | null;
}

// List photos with reaction and comment counts (optimized: 2 queries instead of 1+3N)
export async function listPhotosWithCounts(
  db: D1Database,
  groupId: string,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<PhotoWithCounts[]> {
  // Query 1: Get photos with aggregated counts in a single query
  const photosResult = await db
    .prepare(
      `SELECT
        p.id,
        p.group_id,
        p.r2_key,
        p.caption,
        p.uploaded_by,
        p.uploaded_at,
        p.thumbnail_r2_key,
        COALESCE(c.comment_count, 0) as comment_count,
        ur.emoji as user_reaction
      FROM photos p
      LEFT JOIN (
        SELECT photo_id, COUNT(*) as comment_count
        FROM comments
        WHERE deleted_at IS NULL
        GROUP BY photo_id
      ) c ON c.photo_id = p.id
      LEFT JOIN photo_reactions ur ON ur.photo_id = p.id AND ur.user_id = ?
      WHERE p.group_id = ?
      ORDER BY p.uploaded_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(userId, groupId, limit, offset)
    .all<PhotoWithCountsRow>();

  const photos = photosResult.results || [];

  if (photos.length === 0) {
    return [];
  }

  // Query 2: Get reaction breakdown for all photos in a single batch query
  const photoIds = photos.map((p) => p.id);
  const placeholders = photoIds.map(() => '?').join(',');

  const reactionsResult = await db
    .prepare(
      `SELECT photo_id, emoji, COUNT(*) as count
       FROM photo_reactions
       WHERE photo_id IN (${placeholders})
       GROUP BY photo_id, emoji
       ORDER BY count DESC, emoji ASC`
    )
    .bind(...photoIds)
    .all<{ photo_id: string; emoji: string; count: number }>();

  const reactionsByPhoto = new Map<string, ReactionSummary[]>();
  for (const row of reactionsResult.results || []) {
    const existing = reactionsByPhoto.get(row.photo_id) || [];
    existing.push({ emoji: row.emoji, count: row.count });
    reactionsByPhoto.set(row.photo_id, existing);
  }

  // Combine photos with their reaction summaries
  return photos.map((photo) => ({
    id: photo.id,
    group_id: photo.group_id,
    r2_key: photo.r2_key,
    caption: photo.caption,
    uploaded_by: photo.uploaded_by,
    uploaded_at: photo.uploaded_at,
    thumbnail_r2_key: photo.thumbnail_r2_key,
    comment_count: photo.comment_count,
    reactions: reactionsByPhoto.get(photo.id) || [],
    user_reaction: photo.user_reaction,
  }));
}
