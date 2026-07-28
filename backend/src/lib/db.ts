import { getRandomProfileColor, type ProfileColor } from '@photodrop/common/profileColors';
import type { MembershipRole, ReactionSummary } from '@photodrop/common/apiTypes';
import { generateId, generateInviteToken } from './crypto';

export type { MembershipRole, ReactionSummary };

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

export interface Membership {
  user_id: string;
  group_id: string;
  role: MembershipRole;
  joined_at: number;
  image_protection: number;
  /** Per-group override of the user's canonical name; null when unset. */
  display_name: string | null;
}

export interface MembershipWithGroup extends Membership {
  group_name: string;
  group_owner_id: string;
}

export interface MembershipWithUser extends Membership {
  /** Group-resolved name: the display name override when set, else `users.name`. */
  user_name: string;
  /**
   * The user's own `users.name`, the same in every group and writable only by
   * the user themselves. Carried alongside `user_name` so an admin surface can
   * show whose name an override stands in for; never surface it to non-admins.
   */
  canonical_name: string;
  user_email: string;
  user_profile_color: ProfileColor;
}

/**
 * SQL for the name to show for a user inside a group: their per-group display
 * name when one is set, otherwise their canonical name. Queries embedding this
 * must alias memberships as `m` and users as `u`, and must join the membership
 * row for the group whose context the name is displayed in — resolving against
 * any other group's membership would leak one group's override into another.
 *
 * Shared by every read path that renders a name so they cannot drift: a query
 * that resolved `u.name` directly would show the canonical name next to
 * overridden ones.
 */
const RESOLVED_MEMBER_NAME = 'COALESCE(m.display_name, u.name)';

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

export interface PhotoWithCounts extends Photo {
  reaction_count: number;
  comment_count: number;
  reactions: ReactionSummary[];
  user_reactions: string[];
  /** Null when the uploader's account has since been deleted. */
  uploader_name: string | null;
  uploader_profile_color: ProfileColor | null;
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
  return result.meta.changes > 0;
}

/** Pass null to clear the override and fall back to the user's canonical name. */
export async function updateMemberDisplayName(
  db: D1Database,
  userId: string,
  groupId: string,
  displayName: string | null
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE memberships SET display_name = ? WHERE user_id = ? AND group_id = ?')
    .bind(displayName, userId, groupId)
    .run();
  return result.meta.changes > 0;
}

export interface MemberNames {
  /** The name this group shows: the override when set, else the canonical name. */
  resolvedName: string;
  /** The user's own name, identical in every group and only theirs to change. */
  canonicalName: string;
}

/**
 * Both names a user has inside a group. Null when the user has no membership of
 * that group (or no longer exists), which callers must handle rather than
 * falling back to the canonical name — a non-member has no resolved name in the
 * group at all.
 */
export async function getMemberNames(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<MemberNames | null> {
  const result = await db
    .prepare(
      `SELECT ${RESOLVED_MEMBER_NAME} as resolved_name, u.name as canonical_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.user_id = ? AND m.group_id = ?`
    )
    .bind(userId, groupId)
    .first<{ resolved_name: string; canonical_name: string }>();

  if (!result) {
    return null;
  }

  return { resolvedName: result.resolved_name, canonicalName: result.canonical_name };
}

/**
 * The name to show for a user inside a group, for callers that must not handle
 * the canonical name at all (it is not theirs to render).
 */
export async function getResolvedMemberName(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<string | null> {
  const names = await getMemberNames(db, userId, groupId);

  return names?.resolvedName ?? null;
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
      `SELECT m.user_id, m.group_id, m.role, m.joined_at, m.image_protection, m.display_name, g.name as group_name, g.owner_id as group_owner_id
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
        `SELECT m.user_id, m.group_id, m.role, m.joined_at, m.image_protection, m.display_name,
                ${RESOLVED_MEMBER_NAME} as user_name, u.name as canonical_name,
                u.email as user_email, u.profile_color as user_profile_color
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

  return { success: result.meta.changes > 0 };
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

  return { success: result.meta.changes > 0 };
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

  return result.meta.changes > 0;
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

  return result.meta.changes > 0;
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

/**
 * Atomically consume a magic link token. The conditional update means exactly
 * one of any concurrent verification attempts can win; returns false when the
 * token was already used (or does not exist).
 */
export async function markMagicLinkTokenUsed(db: D1Database, token: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL')
    .bind(now, token)
    .run();

  return result.meta.changes > 0;
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

/**
 * A refresh token session: one device's login, revocable server-side. See
 * migrations/0015_sessions.sql for what each column means and why the table is
 * shaped this way. The policy that decides when to rotate, accept or revoke
 * lives in lib/sessions.ts — everything here is just the SQL.
 */
export interface Session {
  jti: string;
  previous_jti: string;
  family_id: string;
  user_id: string;
  created_at: number;
  rotated_at: number;
  last_used_at: number;
  expires_at: number;
}

export async function createSession(
  db: D1Database,
  userId: string,
  familyId: string,
  jti: string,
  expiresAt: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // previous_jti is seeded to jti (and rotated_at to created_at) so a session
  // that has never rotated still satisfies "both columns are always set".
  await db
    .prepare(
      `INSERT INTO sessions (jti, previous_jti, family_id, user_id, created_at, rotated_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(jti, jti, familyId, userId, now, now, now, expiresAt)
    .run();
}

export async function getSessionByFamily(
  db: D1Database,
  familyId: string
): Promise<Session | null> {
  return db.prepare('SELECT * FROM sessions WHERE family_id = ?').bind(familyId).first<Session>();
}

/**
 * Atomically consume the presented refresh token and replace it with a new one.
 * The guard is the whole point: it succeeds only for the family's *current*,
 * unexpired token, so concurrent refreshes presenting the same token can only
 * have one winner, and a replayed (already rotated) token can never rotate.
 * Returns false without touching the row in every other case, leaving the
 * caller to work out which case it was.
 */
export async function rotateSession(
  db: D1Database,
  familyId: string,
  presentedJti: string,
  newJti: string,
  expiresAt: number
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .prepare(
      `UPDATE sessions
         SET jti = ?, previous_jti = ?, rotated_at = ?, last_used_at = ?, expires_at = ?
       WHERE family_id = ? AND jti = ? AND expires_at > ?`
    )
    .bind(newJti, presentedJti, now, now, expiresAt, familyId, presentedJti, now)
    .run();

  return result.meta.changes > 0;
}

export async function touchSession(db: D1Database, familyId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare('UPDATE sessions SET last_used_at = ? WHERE family_id = ?')
    .bind(now, familyId)
    .run();
}

/** Revoke a session: on logout, and on refresh token reuse. */
export async function deleteSessionFamily(db: D1Database, familyId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM sessions WHERE family_id = ?').bind(familyId).run();

  return result.meta.changes > 0;
}

/**
 * Delete at most `limit` expired sessions. Called opportunistically from the
 * refresh path instead of from a cron, so the cost has to be bounded and
 * predictable: the subquery walks idx_sessions_expires_at from the oldest
 * expiry and stops at `limit`, so this is a short index range scan plus at most
 * `limit` row deletes, whatever the size of the table. (LIMIT is expressed via
 * the subquery because DELETE ... LIMIT is not available in stock SQLite.)
 */
export async function pruneExpiredSessions(db: D1Database, limit: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .prepare(
      `DELETE FROM sessions
       WHERE jti IN (SELECT jti FROM sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`
    )
    .bind(now, limit)
    .run();

  return result.meta.changes;
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

  return result.meta.changes > 0;
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

  // Idempotent: re-adding an existing reaction is a no-op (preserves created_at).
  await db
    .prepare(
      `INSERT INTO photo_reactions (photo_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (photo_id, user_id, emoji) DO NOTHING`
    )
    .bind(photoId, userId, emoji, now)
    .run();
}

export async function removePhotoReaction(
  db: D1Database,
  photoId: string,
  userId: string,
  emoji: string
): Promise<void> {
  await db
    .prepare('DELETE FROM photo_reactions WHERE photo_id = ? AND user_id = ? AND emoji = ?')
    .bind(photoId, userId, emoji)
    .run();
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

  return result.meta.changes > 0;
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

// The generated id only survives for fresh inserts — on conflict the existing
// row keeps its id — so only the deletion token (which IS updated on conflict)
// is returned.
export async function createPushSubscription(
  db: D1Database,
  userId: string,
  groupId: string,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<{ deletionToken: string } | { error: 'endpoint_owned_by_another_user' }> {
  const id = generateId();
  const deletionToken = generateId();
  const now = Math.floor(Date.now() / 1000);

  // The conflict update is guarded on the owner so an existing row can never
  // be silently reassigned (and its deletion token rotated) by another group
  // member presenting the same endpoint. A guarded-out update reports zero
  // changes, which is how the takeover attempt is detected atomically.
  const result = await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, group_id, endpoint, p256dh, auth, deletion_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint, group_id) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         deletion_token = excluded.deletion_token
       WHERE push_subscriptions.user_id = excluded.user_id`
    )
    .bind(id, userId, groupId, endpoint, p256dh, auth, deletionToken, now)
    .run();

  if (result.meta.changes === 0) {
    return { error: 'endpoint_owned_by_another_user' };
  }

  return { deletionToken };
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

/**
 * Recipients of a group's notifications. The membership join is what revokes
 * delivery: a removed member's rows are cleaned up on removal, but relying on
 * that cleanup alone would keep notifying anyone whose cleanup was missed or
 * failed, so the query itself refuses to return non-members.
 */
export async function getGroupPushSubscriptions(
  db: D1Database,
  groupId: string,
  excludeUserId?: string
): Promise<PushSubscription[]> {
  const baseQuery = `SELECT ps.* FROM push_subscriptions ps
       JOIN memberships m ON m.user_id = ps.user_id AND m.group_id = ps.group_id
       WHERE ps.group_id = ?`;

  const statement = excludeUserId
    ? db.prepare(`${baseQuery} AND ps.user_id != ?`).bind(groupId, excludeUserId)
    : db.prepare(baseQuery).bind(groupId);

  const result = await statement.all<PushSubscription>();
  return result.results || [];
}

export async function countUserPushSubscriptionsForGroup(
  db: D1Database,
  userId: string,
  groupId: string,
  excludeEndpoint: string
): Promise<number> {
  // The endpoint being (re-)subscribed is excluded so refreshing the keys of an
  // already-registered device is never blocked by the per-group cap.
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM push_subscriptions
       WHERE user_id = ? AND group_id = ? AND endpoint != ?`
    )
    .bind(userId, groupId, excludeEndpoint)
    .first<{ count: number }>();

  return result?.count ?? 0;
}

// Best-effort cleanup of an expired/rejected endpoint; deleting zero rows is fine.
export async function deletePushSubscription(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
}

/**
 * Deletes ALL push subscriptions for an endpoint if the provided token matches
 * any subscription for that endpoint. Used during logout to clean up all
 * subscriptions from the current browser - the token proves ownership of
 * the endpoint without requiring authentication. Returns whether the token
 * was valid (and the endpoint's subscriptions therefore deleted).
 */
export async function deleteAllPushSubscriptionsForEndpointWithToken(
  db: D1Database,
  endpoint: string,
  deletionToken: string
): Promise<{ tokenValid: boolean }> {
  const subscription = await db
    .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? AND deletion_token = ?')
    .bind(endpoint, deletionToken)
    .first();

  if (!subscription) {
    return { tokenValid: false };
  }

  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();

  return { tokenValid: true };
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

  return result.meta.changes > 0;
}

// Bulk cleanup when a member leaves or is removed; deleting zero rows is fine.
export async function deleteAllUserPushSubscriptionsForGroup(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .run();
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

/**
 * Recipients of a group's native notifications. As with push subscriptions, the
 * membership join — not cleanup on removal — is what guarantees an expelled
 * member's device stops receiving the group's photos and captions.
 */
export async function getGroupDeviceTokens(
  db: D1Database,
  groupId: string,
  excludeUserId?: string
): Promise<DeviceToken[]> {
  const baseQuery = `SELECT dt.* FROM device_tokens dt
       JOIN memberships m ON m.user_id = dt.user_id AND m.group_id = dt.group_id
       WHERE dt.group_id = ?`;

  const statement = excludeUserId
    ? db.prepare(`${baseQuery} AND dt.user_id != ?`).bind(groupId, excludeUserId)
    : db.prepare(baseQuery).bind(groupId);

  const result = await statement.all<DeviceToken>();
  return result.results || [];
}

/**
 * Remove a device token from every group it is registered in for this user.
 * An FCM/APNs token identifies a device, not a group membership, so signing out
 * of the app has to detach the whole device rather than just the current group.
 */
export async function deleteUserDeviceTokensForToken(
  db: D1Database,
  userId: string,
  token: string
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM device_tokens WHERE user_id = ? AND token = ?')
    .bind(userId, token)
    .run();

  return result.meta.changes;
}

/**
 * Detach a device token from any other account. The token is a device-scoped
 * secret, so once a different user registers it the previous owner's rows must
 * go — otherwise the new signed-in user keeps receiving the old user's
 * notifications for groups they were never part of.
 */
export async function deleteDeviceTokenForOtherUsers(
  db: D1Database,
  userId: string,
  token: string
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM device_tokens WHERE token = ? AND user_id != ?')
    .bind(token, userId)
    .run();

  return result.meta.changes;
}

// Bulk cleanup when a member leaves or is removed; deleting zero rows is fine.
export async function deleteAllUserDeviceTokensForGroup(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM device_tokens WHERE user_id = ? AND group_id = ?')
    .bind(userId, groupId)
    .run();
}

// Best-effort cleanup of a token FCM reports as invalid; deleting zero rows is fine.
export async function deleteDeviceTokenByToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
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
      // The photo join is what scopes the name to a group: a comment is only
      // ever read in the context of the group its photo belongs to, so that is
      // the membership whose display name applies.
      `SELECT c.id, c.photo_id, c.user_id, c.author_name,
              ${RESOLVED_MEMBER_NAME} as user_name, u.profile_color as author_profile_color,
              c.content, c.created_at, c.deleted_at
       FROM comments c
       JOIN photos p ON p.id = c.photo_id
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN memberships m ON m.user_id = c.user_id AND m.group_id = p.group_id
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

  return result.meta.changes > 0;
}

// Reaction functions with user details
export async function getPhotoReactionsWithUsers(
  db: D1Database,
  photoId: string
): Promise<PhotoReactionWithUser[]> {
  const result = await db
    .prepare(
      // Reactions are shown in the group the reacted-to photo belongs to, so
      // the photo join supplies the group whose display names apply.
      `SELECT pr.photo_id, pr.user_id, pr.emoji, pr.created_at,
              ${RESOLVED_MEMBER_NAME} as user_name, u.profile_color as user_profile_color
       FROM photo_reactions pr
       JOIN photos p ON p.id = pr.photo_id
       JOIN users u ON pr.user_id = u.id
       LEFT JOIN memberships m ON m.user_id = pr.user_id AND m.group_id = p.group_id
       WHERE pr.photo_id = ?
       ORDER BY pr.created_at ASC`
    )
    .bind(photoId)
    .all<PhotoReactionWithUser>();

  return result.results || [];
}

// Internal type for the aggregated query result. The uploader columns come from
// a LEFT JOIN, so they are null once that account no longer exists.
interface PhotoWithCountsRow extends Photo {
  comment_count: number;
  uploader_name: string | null;
  uploader_profile_color: ProfileColor | null;
}

interface ReactionAggregateRow {
  photo_id: string;
  emoji: string;
  count: number;
  reacted_by_user: number;
}

// D1 allows at most 100 bound parameters per statement. The reaction query
// binds the requesting user id plus one parameter per photo id, so keep each
// batch comfortably under that ceiling.
const REACTION_ID_BATCH_SIZE = 90;

// List photos with reaction and comment counts (optimized: 2 queries instead of 1+3N)
export async function listPhotosWithCounts(
  db: D1Database,
  groupId: string,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<PhotoWithCounts[]> {
  // Query 1: Get photos with comment counts in a single query
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
        ${RESOLVED_MEMBER_NAME} as uploader_name,
        u.profile_color as uploader_profile_color
      FROM photos p
      LEFT JOIN (
        SELECT photo_id, COUNT(*) as comment_count
        FROM comments
        WHERE deleted_at IS NULL
        GROUP BY photo_id
      ) c ON c.photo_id = p.id
      LEFT JOIN users u ON u.id = p.uploaded_by
      LEFT JOIN memberships m ON m.user_id = p.uploaded_by AND m.group_id = p.group_id
      WHERE p.group_id = ?
      ORDER BY p.uploaded_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(groupId, limit, offset)
    .all<PhotoWithCountsRow>();

  const photos = photosResult.results || [];

  if (photos.length === 0) {
    return [];
  }

  // Query 2: Get the per-emoji reaction breakdown for the photos, flagging which
  // emoji the requesting user has reacted with. This yields both the public
  // counts and the user's own reactions without a separate join.
  //
  // The photo ids are chunked because D1 rejects a statement with more than 100
  // bound parameters, and this query binds the user id plus one per photo — a
  // single batch would fail outright for the largest page the API allows.
  const photoIds = photos.map((p) => p.id);
  const reactionRows: ReactionAggregateRow[] = [];

  for (let i = 0; i < photoIds.length; i += REACTION_ID_BATCH_SIZE) {
    const batch = photoIds.slice(i, i + REACTION_ID_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    const reactionsResult = await db
      .prepare(
        `SELECT photo_id, emoji, COUNT(*) as count,
              MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) as reacted_by_user
       FROM photo_reactions
       WHERE photo_id IN (${placeholders})
       GROUP BY photo_id, emoji
       ORDER BY count DESC, emoji ASC`
      )
      .bind(userId, ...batch)
      .all<ReactionAggregateRow>();

    reactionRows.push(...(reactionsResult.results || []));
  }

  const reactionsByPhoto = new Map<string, ReactionSummary[]>();
  const userReactionsByPhoto = new Map<string, string[]>();
  const reactionCountByPhoto = new Map<string, number>();
  for (const row of reactionRows) {
    const summaries = reactionsByPhoto.get(row.photo_id) || [];
    summaries.push({ emoji: row.emoji, count: row.count });
    reactionsByPhoto.set(row.photo_id, summaries);

    reactionCountByPhoto.set(
      row.photo_id,
      (reactionCountByPhoto.get(row.photo_id) || 0) + row.count
    );

    if (row.reacted_by_user) {
      const userReactions = userReactionsByPhoto.get(row.photo_id) || [];
      userReactions.push(row.emoji);
      userReactionsByPhoto.set(row.photo_id, userReactions);
    }
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
    reaction_count: reactionCountByPhoto.get(photo.id) || 0,
    comment_count: photo.comment_count,
    reactions: reactionsByPhoto.get(photo.id) || [],
    user_reactions: userReactionsByPhoto.get(photo.id) || [],
    uploader_name: photo.uploader_name,
    uploader_profile_color: photo.uploader_profile_color,
  }));
}
