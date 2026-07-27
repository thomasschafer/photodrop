/**
 * Refresh token session policy: when a presented refresh token may be rotated,
 * when it must be rejected, and when it is evidence of a leak.
 *
 * The storage shape it works over is described in migrations/0015_sessions.sql;
 * the SQL itself lives in lib/db.ts. Everything below is the reasoning that sits
 * between the two, kept out of the route handlers because four endpoints mint
 * refresh tokens and all of them have to agree on it.
 */
import {
  createSession,
  deleteSessionFamily,
  getSessionByFamily,
  pruneExpiredSessions,
  rotateSession,
  touchSession,
} from './db';
import { generateId } from './crypto';
import { REFRESH_TOKEN_TTL_SECONDS, type RefreshTokenPayload } from './jwt';
import { logger } from './logger';

/** The session a refresh token belongs to, and the token's own id within it. */
export interface SessionIdentity {
  jti: string;
  familyId: string;
}

/**
 * How long the immediately superseded refresh token stays acceptable.
 *
 * Rotation is not atomic from the client's point of view: two tabs can present
 * the same token at the same moment, and a client whose response is lost still
 * holds the token the server has already rotated away. Both are indistinguishable
 * from a replay, so without a grace window ordinary use would trip reuse
 * detection and sign the device out. A few seconds is enough for either case and
 * short enough that a leaked token is worthless: it also cannot be *used* within
 * the window (the grace path never issues a new token id), it only avoids
 * punishing the family.
 */
export const ROTATION_GRACE_SECONDS = 30;

/**
 * Expired rows deleted per refresh. Bounded so the hot path cost cannot grow
 * with the table; see pruneExpiredSessions.
 */
const PRUNE_BATCH_SIZE = 50;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function newExpiry(): number {
  return nowSeconds() + REFRESH_TOKEN_TTL_SECONDS;
}

/** Begin a brand new session (a new device, or one whose session is gone). */
export async function startSession(db: D1Database, userId: string): Promise<SessionIdentity> {
  const session = { jti: generateId(), familyId: generateId() };
  await createSession(db, userId, session.familyId, session.jti, newExpiry());
  return session;
}

/**
 * Issue a session for an endpoint that has authenticated the caller by other
 * means (magic link, access token, group selection token).
 *
 * When the request already carries a session for the same user, that session is
 * rotated rather than a second one started: switching group or logging in again
 * in the same browser must not leave the previous refresh token alive alongside
 * the new one, since logout only revokes the session the cookie names and the
 * abandoned one would then be unreachable for 30 days.
 */
export async function reissueSession(
  db: D1Database,
  userId: string,
  presented: RefreshTokenPayload | null
): Promise<SessionIdentity> {
  // The user check matters: a cookie left behind by a different account must
  // never be rotated into this user's session.
  if (presented && presented.sub === userId) {
    const jti = generateId();
    if (await rotateSession(db, presented.familyId, presented.jti, jti, newExpiry())) {
      return { jti, familyId: presented.familyId };
    }

    // The cookie names a session that could not be rotated — already rotated
    // away, expired, or revoked. Delete whatever is left of it before starting a
    // fresh one, so the old family cannot outlive this request. Deliberately no
    // reuse detection here: these endpoints authenticated the caller
    // independently, and a stale cookie on them is ordinary rather than
    // evidence of a leak.
    await deleteSessionFamily(db, presented.familyId);
  }

  return startSession(db, userId);
}

/**
 * Consume a presented refresh token on /auth/refresh.
 *
 * Returns the identity the caller should mint the next refresh token with, or
 * null when the token must be rejected. Null covers "never existed", "logged
 * out", "expired" and "revoked as reused" alike: the client's teardown path
 * keys off the resulting 401, and distinguishing them to the caller would tell
 * an attacker which of their guesses named a real session.
 */
export async function refreshSession(
  db: D1Database,
  token: RefreshTokenPayload
): Promise<SessionIdentity | null> {
  // Pruning first is the fail-safe order: if it throws, nothing has been
  // rotated and the client's token is still the current one, so a retry works.
  // Doing it after a successful rotation would cost the client its new token.
  await pruneExpiredSessions(db, PRUNE_BATCH_SIZE);

  const jti = generateId();
  if (await rotateSession(db, token.familyId, token.jti, jti, newExpiry())) {
    return { jti, familyId: token.familyId };
  }

  return classifyFailedRotation(db, token);
}

/**
 * Work out why rotation did not happen. Only reached when the presented token
 * verified but was not the family's current, unexpired token — off the hot path.
 */
async function classifyFailedRotation(
  db: D1Database,
  token: RefreshTokenPayload
): Promise<SessionIdentity | null> {
  const session = await getSessionByFamily(db, token.familyId);

  // No row: signed out on this device, expired and pruned, or a session that
  // never existed. Nothing to revoke, and nothing to infer.
  if (!session) {
    return null;
  }

  const now = nowSeconds();

  // The session itself has run out. Not a leak — the row is left for the next
  // prune rather than deleted here, so this path stays read-only.
  if (session.expires_at <= now) {
    return null;
  }

  // The token this one replaced, presented within the grace window: a concurrent
  // refresh from another tab, or a retry after a lost response. Hand back the
  // session's current token id — deliberately not a new one, so this path can
  // never fork a family into two live tokens no matter how often it is hit.
  if (session.previous_jti === token.jti && now - session.rotated_at <= ROTATION_GRACE_SECONDS) {
    await touchSession(db, token.familyId);
    return { jti: session.jti, familyId: session.family_id };
  }

  // Everything the guarded UPDATE rejects is accounted for above except one
  // case: a token we minted, for a live family, that is neither the current
  // token nor the one just superseded. It can only be a copy of a token that
  // was already rotated away — i.e. two parties are holding tokens from this
  // lineage, and we cannot tell which of them is the legitimate user. The
  // standard response for rotating refresh tokens applies: revoke the whole
  // family, not just the presented token, so the attacker's copy dies with the
  // victim's and the user re-authenticates.
  if (session.jti === token.jti) {
    // Unreachable: rotation is guarded on exactly (family_id, jti, not expired),
    // and both of the other two guards were just re-checked above. Reaching here
    // would mean the guard and this classification disagree, which would make
    // every refresh on this session look like reuse. Fail loudly rather than
    // silently revoking the user's session on the strength of a bug.
    throw new Error(
      `Session rotation failed for the family's current, unexpired token (family ${token.familyId})`
    );
  }

  logger.warn('Refresh token reuse detected, revoking session family', {
    userId: token.sub,
    familyId: token.familyId,
  });
  await deleteSessionFamily(db, token.familyId);
  return null;
}

/**
 * Revoke a single session. Used by logout, which must end this device's session
 * only — the user stays signed in everywhere else.
 */
export async function revokeSession(db: D1Database, familyId: string): Promise<void> {
  await deleteSessionFamily(db, familyId);
}
