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
  type Session,
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
 * the same token at the same moment, and a client whose response is lost (a
 * backgrounded PWA, a cell handover, a 5xx) still holds the token the server has
 * already rotated away. Both are indistinguishable from a replay, so outside
 * this window ordinary use trips reuse detection and signs the device out.
 *
 * What the window costs is not just leniency. Inside it, whoever presents the
 * superseded token is handed the family's *current* token id plus a fresh access
 * token: the grace path returns a SessionIdentity and /auth/refresh mints from
 * it like any other refresh. So a captured superseded token is fully usable
 * until the window closes — the window bounds the opportunity to take over the
 * session, not merely the capability to annoy the family. That is also why the
 * window cannot simply be removed: an attacker holding a stolen token who
 * refreshed once between each of the victim's refreshes would ride an unbounded
 * grace path forever and never be detected. Elapsed time is the only
 * discriminator between a straggler and a replay that exists here.
 *
 * Five minutes is the compromise. The client refreshes every 14 minutes and also
 * refreshes on demand behind a 401, so a lost response is followed either by a
 * prompt retry (well inside five minutes) or by the next interval tick (outside
 * it, and still a sign-out). Covering the whole 14-minute cadence would make the
 * hijack window as long as the refresh interval; five minutes covers every case
 * where the client comes back promptly, stays below the 15-minute access token
 * lifetime an attacker would gain anyway, and keeps a stolen token's usable life
 * in minutes rather than the token's own 30 days.
 *
 * Reuse detections are logged (see classifyFailedRotation) so the real
 * false-positive rate can be measured before this is tuned again.
 */
export const ROTATION_GRACE_SECONDS = 5 * 60;

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

/**
 * The family's session, if it still has a usable one. Null covers "no row"
 * (signed out, already pruned, or a family that never existed) and "expired"
 * alike. Deliberately read-only: an expired row is left for the next prune
 * rather than deleted here.
 */
async function getLiveSession(db: D1Database, familyId: string): Promise<Session | null> {
  const session = await getSessionByFamily(db, familyId);

  return session && session.expires_at > nowSeconds() ? session : null;
}

/**
 * Whether a token the guarded rotation refused is the one this session has just
 * rotated away, presented soon enough to be a straggler rather than a replay.
 * See ROTATION_GRACE_SECONDS for what the bound is worth.
 */
function isWithinRotationGrace(session: Session, token: RefreshTokenPayload): boolean {
  return (
    session.previous_jti === token.jti &&
    nowSeconds() - session.rotated_at <= ROTATION_GRACE_SECONDS
  );
}

/**
 * Accept a straggler: hand back the session's current token id, deliberately not
 * a new one, so this path can never fork a family into two live tokens no matter
 * how often it is hit — and so it cannot lose a race against the rotation that
 * superseded the presented token.
 */
async function acceptSupersededToken(db: D1Database, session: Session): Promise<SessionIdentity> {
  await touchSession(db, session.family_id);

  return { jti: session.jti, familyId: session.family_id };
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

    // Rotation was refused, but the cookie may still be the token another tab's
    // /auth/refresh rotated away moments ago: these endpoints and /auth/refresh
    // are separate, and the client only single-flights the latter, so they
    // genuinely race. Honouring the same grace window keeps this request on the
    // live family instead of deleting a session the other tab is still using.
    const session = await getLiveSession(db, presented.familyId);
    if (session && isWithinRotationGrace(session, presented)) {
      return acceptSupersededToken(db, session);
    }

    // The cookie names a session that is genuinely unusable — no row, expired,
    // revoked, or a token this family stopped recognising long enough ago that
    // it cannot be a straggler. Delete whatever is left of it before starting a
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
  // No usable session: signed out on this device, expired (whether or not
  // pruning has reached it yet), or a family that never existed. Nothing to
  // revoke, and nothing to infer — an expired session is not evidence of a leak.
  const session = await getLiveSession(db, token.familyId);
  if (!session) {
    return null;
  }

  // The token this one replaced, presented within the grace window: a concurrent
  // refresh from another tab, or a retry after a lost response.
  if (isWithinRotationGrace(session, token)) {
    return acceptSupersededToken(db, session);
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

  // Logged in enough detail to tell a real leak from a client we punished for
  // coming back late: a burst of detections whose presented token *was* the
  // superseded one, just past the window, means ROTATION_GRACE_SECONDS is too
  // tight rather than that tokens are leaking. No token material is logged —
  // ids only, and they are worthless without the signed token itself.
  const now = nowSeconds();
  logger.warn('Refresh token reuse detected, revoking session family', {
    userId: token.sub,
    familyId: token.familyId,
    presentedJti: token.jti,
    currentJti: session.jti,
    /** True when only the grace window's length stood between this and acceptance. */
    presentedSupersededToken: session.previous_jti === token.jti,
    secondsSinceRotation: now - session.rotated_at,
    secondsSinceLastUse: now - session.last_used_at,
    sessionAgeSeconds: now - session.created_at,
    graceSeconds: ROTATION_GRACE_SECONDS,
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
