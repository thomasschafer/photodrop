import { generateId, generateInviteToken } from './crypto';

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
  created_at: number;
  last_seen_at: number | null;
}

export type MembershipRole = 'admin' | 'member';

export interface Membership {
  user_id: string;
  group_id: string;
  role: MembershipRole;
  joined_at: number;
}

export interface MembershipWithGroup extends Membership {
  group_name: string;
  group_owner_id: string;
}

export interface MembershipWithUser extends Membership {
  user_name: string;
  user_email: string;
}

export interface MagicLinkToken {
  token: string;
  group_id: string;
  email: string;
  type: 'invite' | 'login';
  invite_role: MembershipRole | null; // 'admin' or 'member' only
  created_at: number;
  expires_at: number;
  used_at: number | null;
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
}

export interface Comment {
  id: string;
  photo_id: string;
  user_id: string | null;
  author_name: string;
  content: string;
  created_at: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface PhotoWithCounts extends Photo {
  reaction_count: number;
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

// User functions
export async function createUser(db: D1Database, name: string, email: string): Promise<string> {
  const userId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO users (id, name, email, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(userId, name, email, now)
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
      `SELECT m.user_id, m.group_id, m.role, m.joined_at, g.name as group_name, g.owner_id as group_owner_id
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
        `SELECT m.user_id, m.group_id, m.role, m.joined_at, u.name as user_name, u.email as user_email
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
  const result = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();

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

// Magic link token functions
export async function createMagicLinkToken(
  db: D1Database,
  groupId: string,
  email: string,
  type: 'invite' | 'login',
  inviteRole?: 'admin' | 'member'
): Promise<string> {
  const token = generateInviteToken(); // Reuse this for cryptographically random tokens
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 15 * 60; // 15 minutes

  await db
    .prepare(
      `INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(token, groupId, email, type, inviteRole || null, now, expiresAt)
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
  created_at: number;
}

export async function createPushSubscription(
  db: D1Database,
  userId: string,
  groupId: string,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<string> {
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, group_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         group_id = excluded.group_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`
    )
    .bind(id, userId, groupId, endpoint, p256dh, auth, now)
    .run();

  return id;
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
      `SELECT id, photo_id, user_id, author_name, content, created_at
       FROM comments
       WHERE photo_id = ?
       ORDER BY created_at DESC`
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
  const result = await db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();

  return result.success;
}

export async function getCommentCount(db: D1Database, photoId: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM comments WHERE photo_id = ?')
    .bind(photoId)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

// Reaction functions with user details
export async function getPhotoReactionsWithUsers(
  db: D1Database,
  photoId: string
): Promise<PhotoReactionWithUser[]> {
  const result = await db
    .prepare(
      `SELECT pr.photo_id, pr.user_id, pr.emoji, pr.created_at, u.name as user_name
       FROM photo_reactions pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.photo_id = ?
       ORDER BY pr.created_at ASC`
    )
    .bind(photoId)
    .all<PhotoReactionWithUser>();

  return result.results || [];
}

export async function getReactionSummary(
  db: D1Database,
  photoId: string
): Promise<ReactionSummary[]> {
  const result = await db
    .prepare(
      `SELECT emoji, COUNT(*) as count
       FROM photo_reactions
       WHERE photo_id = ?
       GROUP BY emoji
       ORDER BY count DESC, emoji ASC`
    )
    .bind(photoId)
    .all<ReactionSummary>();

  return result.results || [];
}

export async function getUserReaction(
  db: D1Database,
  photoId: string,
  userId: string
): Promise<string | null> {
  const result = await db
    .prepare('SELECT emoji FROM photo_reactions WHERE photo_id = ? AND user_id = ?')
    .bind(photoId, userId)
    .first<{ emoji: string }>();

  return result?.emoji ?? null;
}

// List photos with reaction and comment counts
export async function listPhotosWithCounts(
  db: D1Database,
  groupId: string,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<PhotoWithCounts[]> {
  const photos = await listPhotos(db, groupId, limit, offset);

  const photosWithCounts = await Promise.all(
    photos.map(async (photo) => {
      const [reactions, commentCount, userReaction] = await Promise.all([
        getReactionSummary(db, photo.id),
        getCommentCount(db, photo.id),
        getUserReaction(db, photo.id, userId),
      ]);

      return {
        ...photo,
        reaction_count: reactions.reduce((sum, r) => sum + r.count, 0),
        comment_count: commentCount,
        reactions,
        user_reaction: userReaction,
      };
    })
  );

  return photosWithCounts;
}
