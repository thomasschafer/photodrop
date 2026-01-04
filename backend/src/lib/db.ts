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
