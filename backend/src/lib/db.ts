import { generateId, generateInviteToken } from './crypto';

export interface User {
  id: string;
  name: string;
  phone: string | null;
  role: 'admin' | 'viewer';
  invite_token: string | null;
  invite_role: 'admin' | 'viewer' | null;
  invite_accepted_at: number | null;
  created_at: number;
  last_seen_at: number | null;
}

export interface Photo {
  id: string;
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

export async function createInvite(
  db: D1Database,
  name: string,
  role: 'admin' | 'viewer' = 'viewer',
  phone?: string
): Promise<{ userId: string; inviteToken: string }> {
  const userId = generateId();
  const inviteToken = generateInviteToken();
  const now = Math.floor(Date.now() / 1000);

  const query = phone
    ? `INSERT INTO users (id, name, phone, role, invite_token, invite_role, created_at)
       VALUES (?, ?, ?, 'viewer', ?, ?, ?)`
    : `INSERT INTO users (id, name, role, invite_token, invite_role, created_at)
       VALUES (?, ?, 'viewer', ?, ?, ?)`;

  const params = phone
    ? [userId, name, phone, inviteToken, role, now]
    : [userId, name, inviteToken, role, now];

  await db.prepare(query).bind(...params).run();

  return { userId, inviteToken };
}

export async function getUserByInviteToken(
  db: D1Database,
  inviteToken: string
): Promise<User | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE invite_token = ?')
    .bind(inviteToken)
    .first<User>();

  return result;
}

export async function getUserById(
  db: D1Database,
  userId: string
): Promise<User | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<User>();

  return result;
}

export async function acceptInvite(
  db: D1Database,
  inviteToken: string
): Promise<User | null> {
  const user = await getUserByInviteToken(db, inviteToken);
  if (!user || user.invite_accepted_at) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  const isFirstUser = await isFirstUserInSystem(db);
  const finalRole = isFirstUser ? 'admin' : (user.invite_role || 'viewer');

  await db
    .prepare(
      `UPDATE users
       SET invite_accepted_at = ?, role = ?, invite_token = NULL
       WHERE id = ?`
    )
    .bind(now, finalRole, user.id)
    .run();

  return getUserById(db, user.id);
}

export async function isFirstUserInSystem(db: D1Database): Promise<boolean> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM users WHERE invite_accepted_at IS NOT NULL')
    .first<{ count: number }>();

  return (result?.count || 0) === 0;
}

export async function getAllUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare('SELECT * FROM users WHERE invite_accepted_at IS NOT NULL ORDER BY created_at DESC')
    .all<User>();

  return result.results || [];
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: 'admin' | 'viewer'
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE users SET role = ? WHERE id = ?')
    .bind(role, userId)
    .run();

  return result.success;
}

export async function deleteUser(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM users WHERE id = ?')
    .bind(userId)
    .run();

  return result.success;
}

export async function countAdmins(db: D1Database): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM users WHERE role = ? AND invite_accepted_at IS NOT NULL')
    .bind('admin')
    .first<{ count: number }>();

  return result?.count || 0;
}

export async function createPhoto(
  db: D1Database,
  r2Key: string,
  thumbnailR2Key: string,
  uploadedBy: string,
  caption?: string
): Promise<string> {
  const photoId = generateId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO photos (id, r2_key, thumbnail_r2_key, caption, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(photoId, r2Key, thumbnailR2Key, caption || null, uploadedBy, now)
    .run();

  return photoId;
}

export async function getPhoto(
  db: D1Database,
  photoId: string
): Promise<Photo | null> {
  const result = await db
    .prepare('SELECT * FROM photos WHERE id = ?')
    .bind(photoId)
    .first<Photo>();

  return result;
}

export async function listPhotos(
  db: D1Database,
  limit: number = 20,
  offset: number = 0
): Promise<Photo[]> {
  const result = await db
    .prepare('SELECT * FROM photos ORDER BY uploaded_at DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<Photo>();

  return result.results || [];
}

export async function deletePhoto(
  db: D1Database,
  photoId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM photos WHERE id = ?')
    .bind(photoId)
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

export async function getPhotoReactions(
  db: D1Database,
  photoId: string
): Promise<PhotoReaction[]> {
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
