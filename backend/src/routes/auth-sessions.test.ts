/**
 * End-to-end tests for server-side session revocation.
 *
 * Unlike the other auth route tests, these use the real JWT and session code and
 * mock only the database, so a request's refresh cookie is a genuine signed
 * token and the endpoints are driven the way a browser drives them. That is the
 * only way to test what these behaviours actually are: what a *token* can still
 * do after a logout, a rotation or a replay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

interface SessionRow {
  jti: string;
  previous_jti: string;
  family_id: string;
  user_id: string;
  created_at: number;
  rotated_at: number;
  last_used_at: number;
  expires_at: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Stand-in for the `sessions` table, implementing exactly the behaviour the SQL
 * in lib/db.ts specifies (those statements are asserted directly in db.test.ts).
 * Keyed by family_id rather than jti because every lookup the code performs is
 * by family — the real table gets there via the UNIQUE constraint on that
 * column.
 */
const store = {
  rows: new Map<string, SessionRow>(),

  reset() {
    this.rows.clear();
  },

  create(userId: string, familyId: string, jti: string, expiresAt: number): void {
    const now = nowSeconds();
    if (this.rows.has(familyId)) {
      throw new Error(`family ${familyId} already exists`);
    }
    this.rows.set(familyId, {
      jti,
      previous_jti: jti,
      family_id: familyId,
      user_id: userId,
      created_at: now,
      rotated_at: now,
      last_used_at: now,
      expires_at: expiresAt,
    });
  },

  get(familyId: string): SessionRow | null {
    return this.rows.get(familyId) ?? null;
  },

  rotate(familyId: string, presentedJti: string, newJti: string, expiresAt: number): boolean {
    const row = this.rows.get(familyId);
    const now = nowSeconds();
    if (!row || row.jti !== presentedJti || row.expires_at <= now) {
      return false;
    }
    this.rows.set(familyId, {
      ...row,
      jti: newJti,
      previous_jti: presentedJti,
      rotated_at: now,
      last_used_at: now,
      expires_at: expiresAt,
    });
    return true;
  },

  touch(familyId: string): void {
    const row = this.rows.get(familyId);
    if (row) {
      this.rows.set(familyId, { ...row, last_used_at: nowSeconds() });
    }
  },

  deleteFamily(familyId: string): boolean {
    return this.rows.delete(familyId);
  },

  prune(limit: number): number {
    const now = nowSeconds();
    const expired = [...this.rows.values()]
      .filter((row) => row.expires_at <= now)
      .sort((a, b) => a.expires_at - b.expires_at)
      .slice(0, limit);
    for (const row of expired) {
      this.rows.delete(row.family_id);
    }
    return expired.length;
  },
};

const membership = {
  user_id: 'user-1',
  group_id: 'group-1',
  role: 'member' as const,
  joined_at: 1000,
  image_protection: 0,
  display_name: null,
  group_name: 'Group One',
  group_owner_id: 'user-1',
};

const user = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  profile_color: 'terracotta',
  created_at: 1000,
  last_seen_at: null,
};

const mockGetUserMemberships = vi.fn();

vi.mock('../lib/db', () => ({
  createSession: (_db: unknown, userId: string, familyId: string, jti: string, expiresAt: number) =>
    Promise.resolve(store.create(userId, familyId, jti, expiresAt)),
  getSessionByFamily: (_db: unknown, familyId: string) => Promise.resolve(store.get(familyId)),
  rotateSession: (
    _db: unknown,
    familyId: string,
    presentedJti: string,
    newJti: string,
    expiresAt: number
  ) => Promise.resolve(store.rotate(familyId, presentedJti, newJti, expiresAt)),
  touchSession: (_db: unknown, familyId: string) => Promise.resolve(store.touch(familyId)),
  deleteSessionFamily: (_db: unknown, familyId: string) =>
    Promise.resolve(store.deleteFamily(familyId)),
  pruneExpiredSessions: (_db: unknown, limit: number) => Promise.resolve(store.prune(limit)),

  getUserById: () => Promise.resolve(user),
  getMembership: () => Promise.resolve(membership),
  getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  getGroup: vi.fn(),
  createMembership: vi.fn(),
  createMagicLinkToken: vi.fn(),
  getMagicLinkToken: vi.fn(),
  markMagicLinkTokenUsed: vi.fn(),
  markMagicLinkTokenPending: vi.fn(),
}));

vi.mock('../lib/email', () => ({ sendInviteEmail: vi.fn(), sendLoginLinkEmail: vi.fn() }));
vi.mock('../middleware/rateLimit', () => ({
  createRateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  rateLimitKeys: { byUserId: () => () => '', byEmailFromBody: () => () => '' },
  getClientIP: () => '127.0.0.1',
}));

// Imported after the mocks so the routes bind to them.
import auth from './auth';
import { errorHandler } from '../lib/errorHandler';
import { generateAccessToken, generateJWT, verifyJWT, type JWTClaims } from '../lib/jwt';
import { ROTATION_GRACE_SECONDS } from '../lib/sessions';

const SECRET = 'test-secret';
const NOW = 1_700_000_000;

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET: SECRET, DB: {}, FRONTEND_URL: 'http://localhost:5173' };
    await next();
  });
  app.route('/auth', auth);
  app.onError(errorHandler);
  return app;
}

function refreshCookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie');
  const match = header && /refreshToken=([^;]*)/.exec(header);
  if (!match) {
    throw new Error(`response set no refresh cookie: ${header}`);
  }
  return match[1];
}

async function jtiOf(refreshToken: string): Promise<string> {
  const payload = await verifyJWT(refreshToken, SECRET);
  if (payload?.type !== 'refresh') {
    throw new Error('not a usable refresh token');
  }
  return payload.jti;
}

describe('refresh token sessions', () => {
  let app: Hono;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    vi.resetAllMocks();
    store.reset();
    mockGetUserMemberships.mockResolvedValue([membership]);
    app = createApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sending no cookie makes the request a device that has no session yet. */
  async function postSwitchGroup(refreshToken?: string) {
    const accessToken = await generateAccessToken('user-1', 'group-1', 'member', SECRET);
    return app.request('/auth/switch-group', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(refreshToken ? { Cookie: `refreshToken=${refreshToken}` } : {}),
      },
      body: JSON.stringify({ groupId: 'group-1' }),
    });
  }

  /**
   * Signs a device in and returns its refresh token. Uses /auth/switch-group
   * because it is the shortest real path to a session; deliberately sends no
   * cookie, so each call is a separate device.
   */
  async function signIn(): Promise<string> {
    const res = await postSwitchGroup();

    expect(res.status).toBe(200);
    return refreshCookieFrom(res);
  }

  function postRefresh(refreshToken: string) {
    return app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
  }

  function postLogout(refreshToken?: string) {
    return app.request('/auth/logout', {
      method: 'POST',
      headers: refreshToken ? { Cookie: `refreshToken=${refreshToken}` } : {},
    });
  }

  describe('logout', () => {
    it('invalidates the refresh token it was given', async () => {
      const refreshToken = await signIn();
      expect((await postRefresh(refreshToken)).status).toBe(200);

      const logout = await postLogout(refreshToken);

      expect(logout.status).toBe(200);
      expect(store.rows.size).toBe(0);
      // The captured token itself is now worthless, which clearing the cookie
      // alone never achieved.
      expect((await postRefresh(refreshToken)).status).toBe(401);
    });

    it('leaves the user’s other devices signed in', async () => {
      const laptop = await signIn();
      const phone = await signIn();
      expect(store.rows.size).toBe(2);

      await postLogout(laptop);

      expect((await postRefresh(laptop)).status).toBe(401);
      // Signing out here must not sign the user out everywhere; that is the
      // whole reason sessions are rows rather than a per-user counter.
      expect((await postRefresh(phone)).status).toBe(200);
      expect(store.rows.size).toBe(1);
    });

    it('succeeds and clears the cookie when there is no session to revoke', async () => {
      const res = await postLogout();

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toContain('refreshToken=;');
    });
  });

  describe('rotation and reuse detection', () => {
    it('replaces the presented token on every refresh', async () => {
      const first = await signIn();

      const res = await postRefresh(first);
      const second = refreshCookieFrom(res);

      expect(second).not.toBe(first);
      expect(store.rows.size).toBe(1);
      const [row] = [...store.rows.values()];
      expect(row.jti).toBe(await jtiOf(second));
      expect(row.previous_jti).toBe(await jtiOf(first));
    });

    it('rejects a rotated token and revokes its whole family', async () => {
      const first = await signIn();
      const second = refreshCookieFrom(await postRefresh(first));
      vi.setSystemTime((NOW + ROTATION_GRACE_SECONDS + 1) * 1000);

      const replay = await postRefresh(first);

      expect(replay.status).toBe(401);
      // Not just the replayed token: whoever holds the current one is as likely
      // to be the attacker as the user, so the session dies with it.
      expect(store.rows.size).toBe(0);
      expect((await postRefresh(second)).status).toBe(401);
    });

    it('accepts the just-superseded token without forking the session', async () => {
      // Two tabs refreshing at once, or a client whose response was lost: the
      // second request presents a token the server has already rotated away.
      const first = await signIn();
      const second = refreshCookieFrom(await postRefresh(first));
      vi.setSystemTime((NOW + ROTATION_GRACE_SECONDS) * 1000);

      const res = await postRefresh(first);

      expect(res.status).toBe(200);
      expect(store.rows.size).toBe(1);
      // The straggler is handed the session's existing token, not a third one,
      // so the family can never end up with two live tokens.
      expect(await jtiOf(refreshCookieFrom(res))).toBe(await jtiOf(second));
      expect((await postRefresh(second)).status).toBe(200);
    });

    it('still accepts the superseded token minutes after the rotation it missed', async () => {
      // The case the window exists for is not only two tabs racing: a client
      // whose rotation response was lost comes back when the app is next used,
      // which is minutes later, not milliseconds. A window measured in seconds
      // read that as reuse and signed the device out.
      const first = await signIn();
      const second = refreshCookieFrom(await postRefresh(first));
      vi.setSystemTime((NOW + 2 * 60) * 1000);

      const res = await postRefresh(first);

      expect(res.status).toBe(200);
      expect(store.rows.size).toBe(1);
      expect(await jtiOf(refreshCookieFrom(res))).toBe(await jtiOf(second));
    });

    it('keeps the grace window measured in minutes, and well short of the refresh cadence', () => {
      // Both bounds are deliberate. Too short and an honest client that lost a
      // response is signed out; too long and a captured superseded token — which
      // the grace path will exchange for the family's live token and a fresh
      // access token — stays usable for that whole time.
      expect(ROTATION_GRACE_SECONDS).toBeGreaterThanOrEqual(2 * 60);
      expect(ROTATION_GRACE_SECONDS).toBeLessThan(14 * 60);
    });

    it('treats the superseded token as reuse once the grace window closes', async () => {
      const first = await signIn();
      await postRefresh(first);
      vi.setSystemTime((NOW + ROTATION_GRACE_SECONDS + 1) * 1000);

      expect((await postRefresh(first)).status).toBe(401);
      expect(store.rows.size).toBe(0);
    });

    it('does not touch other sessions when one family is revoked', async () => {
      const laptop = await signIn();
      const phone = await signIn();
      await postRefresh(laptop);
      vi.setSystemTime((NOW + ROTATION_GRACE_SECONDS + 1) * 1000);

      expect((await postRefresh(laptop)).status).toBe(401);

      expect((await postRefresh(phone)).status).toBe(200);
    });
  });

  describe('rejecting tokens with no usable session', () => {
    it('rejects a token whose session row is gone', async () => {
      const refreshToken = await signIn();
      store.reset();

      const res = await postRefresh(refreshToken);

      // Indistinguishable from an expired token, by design: the client's 401
      // teardown handles a revoked session with no changes.
      expect(res.status).toBe(401);
      expect((await res.json()) as { error: string }).toEqual({ error: 'Invalid refresh token' });
    });

    it('rejects a token whose session has expired', async () => {
      const refreshToken = await signIn();
      const [family] = [...store.rows.keys()];
      store.rows.set(family, { ...store.rows.get(family)!, expires_at: NOW - 1 });

      expect((await postRefresh(refreshToken)).status).toBe(401);
    });

    it('rejects an expired session pruning has not reached, without calling it reuse', async () => {
      const refreshToken = await signIn();
      const [family] = [...store.rows.keys()];
      store.rows.set(family, { ...store.rows.get(family)!, expires_at: NOW - 1 });
      // Pruning is batched, so an expired row can outlive the prune that ran on
      // the same request. Older expired rows fill the batch here to force that.
      for (let i = 0; i < 50; i++) {
        store.create(`user-${i}`, `family-${i}`, `jti-${i}`, NOW - 1000 + i);
      }

      expect((await postRefresh(refreshToken)).status).toBe(401);
      // Still present: an expired session is not evidence of a leak, so it is
      // left for the next prune rather than revoked.
      expect(store.get(family)).not.toBeNull();
    });

    it('rejects a refresh token issued before sessions existed', async () => {
      // These verify — we minted them — but name no session, so there is nothing
      // to check them against. Every device signed in at deploy hits this once.
      const legacyToken = await generateJWT(
        { sub: 'user-1', groupId: 'group-1', role: 'member', type: 'refresh' } as JWTClaims,
        SECRET,
        60
      );

      expect((await postRefresh(legacyToken)).status).toBe(401);
    });
  });

  describe('pruning', () => {
    it('removes expired rows and only expired rows', async () => {
      const refreshToken = await signIn();
      store.create('user-2', 'family-expired', 'jti-expired', NOW - 1);
      store.create('user-3', 'family-live', 'jti-live', NOW + 1000);

      expect((await postRefresh(refreshToken)).status).toBe(200);

      expect(store.get('family-expired')).toBeNull();
      expect(store.get('family-live')).not.toBeNull();
      expect(store.rows.size).toBe(2);
    });
  });

  describe('sessions across other endpoints', () => {
    it('rotates the device’s session on switch-group rather than starting a second one', async () => {
      // A second session here would be unreachable by logout, which only revokes
      // the session the cookie names — the old refresh token would stay valid.
      const refreshToken = await signIn();
      const [family] = [...store.rows.keys()];

      const res = await postSwitchGroup(refreshToken);

      expect(res.status).toBe(200);
      expect(store.rows.size).toBe(1);
      expect(store.get(family)?.jti).toBe(await jtiOf(refreshCookieFrom(res)));
    });

    it('keeps the session alive when switch-group races a refresh from another tab', async () => {
      // Refresh is single-flighted in the client, but switch-group is a
      // different endpoint: one tab can rotate the family while another is
      // already in flight with the cookie that was current a moment ago.
      const refreshToken = await signIn();
      const [family] = [...store.rows.keys()];
      const rotated = refreshCookieFrom(await postRefresh(refreshToken));

      const res = await postSwitchGroup(refreshToken);

      expect(res.status).toBe(200);
      // The family the other tab is still using survives, and this response is
      // tied to it rather than to a second session — deleting it would have
      // signed that tab out on its next refresh.
      expect(store.rows.size).toBe(1);
      expect(store.get(family)).not.toBeNull();
      expect(await jtiOf(refreshCookieFrom(res))).toBe(store.get(family)?.jti);
      expect((await postRefresh(rotated)).status).toBe(200);
    });

    it('replaces a cookie too old to be a straggler rather than leaving it alive', async () => {
      const refreshToken = await signIn();
      const [family] = [...store.rows.keys()];
      await postRefresh(refreshToken);
      vi.setSystemTime((NOW + ROTATION_GRACE_SECONDS + 1) * 1000);

      const res = await postSwitchGroup(refreshToken);

      expect(res.status).toBe(200);
      // Past the window the cookie names a session this device can no longer
      // reach, so it goes: logout only revokes the family the cookie names, and
      // an abandoned one would stay valid for its full 30 days.
      expect(store.get(family)).toBeNull();
      expect(store.rows.size).toBe(1);
    });

    it('ends the session when the refreshed group membership is gone', async () => {
      // The response carries a selection token instead of a refresh cookie, so
      // the rotated session would be unusable and unreachable; /auth/select-group
      // starts a fresh one.
      const refreshToken = await signIn();
      mockGetUserMemberships.mockResolvedValue([]);

      const res = await postRefresh(refreshToken);

      expect(res.status).toBe(200);
      expect(store.rows.size).toBe(0);
      expect(res.headers.get('set-cookie')).toContain('refreshToken=;');
    });
  });
});
