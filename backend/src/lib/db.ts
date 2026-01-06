import { generateId, generateInviteToken } from './crypto';

export interface Group {
  id: string;
  name: string;
  created_at: number;
  created_by: string;
}

export interface User {
  id: string;
  group_id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  invite_accepted_at: number | null;
  created_at: number;
  last_seen_at: number | null;
}

export interface MagicLinkToken {
  token: string;
  group_id: string;
  email: string;
  type: 'invite' | 'login';
  invite_role: 'admin' | 'member' | null;
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

// Group functions
export async function createGroup(
  db: D1Database,
  name: string,
  createdBy: string
): Promise<string> {
  const groupId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO groups (id, name, created_at, created_by)
       VALUES (?, ?, ?, ?)`
    )
    .bind(groupId, name, now, createdBy)
    .run();

  return groupId;
}

export async function getGroup(db: D1Database, groupId: string): Promise<Group | null> {
  const result = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<Group>();

  return result;
}

// User functions
export async function createUser(
  db: D1Database,
  groupId: string,
  name: string,
  email: string,
  role: 'admin' | 'member'
): Promise<string> {
  const userId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO users (id, group_id, name, email, role, invite_accepted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, groupId, name, email, role, now, now)
    .run();

  return userId;
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

export async function getAllUsers(db: D1Database, groupId: string): Promise<User[]> {
  const result = await db
    .prepare('SELECT * FROM users WHERE group_id = ? ORDER BY created_at DESC')
    .bind(groupId)
    .all<User>();

  return result.results || [];
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  groupId: string,
  role: 'admin' | 'member'
): Promise<boolean> {
  // Ensure user belongs to the group before updating
  const result = await db
    .prepare('UPDATE users SET role = ? WHERE id = ? AND group_id = ?')
    .bind(role, userId, groupId)
    .run();

  return result.success;
}

export async function deleteUser(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<boolean> {
  // Ensure user belongs to the group before deleting
  const result = await db
    .prepare('DELETE FROM users WHERE id = ? AND group_id = ?')
    .bind(userId, groupId)
    .run();

  return result.success;
}

export async function countAdmins(db: D1Database, groupId: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM users WHERE role = ? AND group_id = ?')
    .bind('admin', groupId)
    .first<{ count: number }>();

  return result?.count || 0;
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
