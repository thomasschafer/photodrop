import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetMembership = vi.fn();
const mockGetUserById = vi.fn();
const mockGetUserMemberships = vi.fn();
const mockGenerateAccessToken = vi.fn();
const mockGenerateRefreshToken = vi.fn();
const mockVerifyJWT = vi.fn();
const mockVerifyGroupSelectionToken = vi.fn();
const mockReissueSession = vi.fn();
const mockRefreshSession = vi.fn();
const mockRevokeSession = vi.fn();

vi.mock('../lib/db', () => ({
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
  getGroup: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  createMembership: vi.fn(),
  createMagicLinkToken: vi.fn(),
  markMagicLinkTokenUsed: vi.fn(),
  markMagicLinkTokenPending: vi.fn(),
}));

vi.mock('../lib/jwt', () => ({
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
  generateRefreshToken: (...args: unknown[]) => mockGenerateRefreshToken(...args),
  generateGroupSelectionToken: vi.fn(),
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
  verifyGroupSelectionToken: (...args: unknown[]) => mockVerifyGroupSelectionToken(...args),
  REFRESH_TOKEN_TTL_SECONDS: 30 * 24 * 60 * 60,
}));

// The session store these routes revoke and rotate against. Its behaviour is
// exercised end-to-end in auth-sessions.test.ts; here it is stubbed so these
// tests stay about the endpoints' own logic.
vi.mock('../lib/sessions', () => ({
  reissueSession: (...args: unknown[]) => mockReissueSession(...args),
  refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
  revokeSession: (...args: unknown[]) => mockRevokeSession(...args),
}));

vi.mock('../lib/magic-links', () => ({ verifyMagicLink: vi.fn() }));
vi.mock('../lib/email', () => ({ sendInviteEmail: vi.fn(), sendLoginLinkEmail: vi.fn() }));
vi.mock('../middleware/rateLimit', () => ({
  createRateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  rateLimitKeys: { byUserId: () => () => '', byEmailFromBody: () => () => '' },
  getClientIP: () => '127.0.0.1',
}));

// Imported after the mocks so the routes bind to them.
import auth from './auth';
import { errorHandler } from '../lib/errorHandler';

// Exercises the real routes and the real requireAuth middleware, so these
// tests fail if the endpoints change behaviour.
function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET: 'test-secret', DB: {}, FRONTEND_URL: 'http://localhost:5173' };
    await next();
  });
  app.route('/auth', auth);
  app.onError(errorHandler);
  return app;
}

const user = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  profile_color: 'terracotta',
  created_at: 1000,
  last_seen_at: null,
};

function membership(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    group_id: 'group-1',
    role: 'member' as const,
    joined_at: 1000,
    image_protection: 0,
    group_name: 'Group One',
    group_owner_id: 'owner-1',
    ...overrides,
  };
}

/** Makes requireAuth accept the request, scoped to `group-1`. */
function authenticate() {
  mockVerifyJWT.mockResolvedValue({
    sub: 'user-1',
    groupId: 'group-1',
    role: 'member',
    type: 'access',
  });
  mockGetMembership.mockResolvedValue(membership());
}

const authHeaders = {
  Authorization: 'Bearer valid-token',
  'Content-Type': 'application/json',
};

function postSwitchGroup(app: Hono, body: unknown, headers: Record<string, string> = authHeaders) {
  return app.request('/auth/switch-group', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /auth/switch-group', () => {
  let app: Hono;

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: the latter clears call history but
    // leaves implementations in place, so a test that forgot a stub would
    // silently inherit the previous test's and pass only in order.
    vi.resetAllMocks();
    app = createApp();
    mockGenerateAccessToken.mockResolvedValue('new-access-token');
    mockGenerateRefreshToken.mockResolvedValue('new-refresh-token');
    mockReissueSession.mockResolvedValue({ jti: 'jti-1', familyId: 'family-1' });
    mockGetUserById.mockResolvedValue(user);
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const res = await postSwitchGroup(
      app,
      { groupId: 'group-2' },
      { 'Content-Type': 'application/json' }
    );

    expect(res.status).toBe(401);
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is invalid or expired', async () => {
    // The likelier 401 in practice: a token is presented but no longer verifies.
    mockVerifyJWT.mockResolvedValue(null);

    const res = await postSwitchGroup(app, { groupId: 'group-2' });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Invalid or expired token');
    expect(mockGetUserMemberships).not.toHaveBeenCalled();
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the membership behind a valid token is gone', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'user-1',
      groupId: 'group-1',
      role: 'member',
      type: 'access',
    });
    mockGetMembership.mockResolvedValue(null);

    const res = await postSwitchGroup(app, { groupId: 'group-2' });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Membership no longer exists');
  });

  it('returns 403 when the user is not a member of the target group', async () => {
    authenticate();
    mockGetUserMemberships.mockResolvedValue([membership()]);

    const res = await postSwitchGroup(app, { groupId: 'group-not-member-of' });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('You are not a member of this group');
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('issues a token scoped to the target group, with that group’s role', async () => {
    authenticate();
    // Member in the current group, admin in the target: the new token must
    // carry the target group's role, not the one the request authenticated with.
    mockGetUserMemberships.mockResolvedValue([
      membership(),
      membership({ group_id: 'group-2', role: 'admin', group_name: 'Group Two' }),
    ]);

    const res = await postSwitchGroup(app, { groupId: 'group-2' });

    expect(res.status).toBe(200);
    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      'user-1',
      'group-2',
      'admin',
      'test-secret'
    );

    const json = (await res.json()) as {
      accessToken: string;
      currentGroup: { id: string; name: string; role: string };
      groups: unknown[];
    };
    expect(json.accessToken).toBe('new-access-token');
    expect(json.currentGroup).toMatchObject({ id: 'group-2', name: 'Group Two', role: 'admin' });
    expect(json.groups).toHaveLength(2);
  });

  it('rotates the refresh cookie', async () => {
    authenticate();
    mockGetUserMemberships.mockResolvedValue([membership()]);

    const res = await postSwitchGroup(app, { groupId: 'group-1' });

    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('refreshToken=new-refresh-token');
    expect(cookie).toContain('HttpOnly');
  });

  it('verifies membership from the list it already fetches, without a second query', async () => {
    authenticate();
    mockGetUserMemberships.mockResolvedValue([membership()]);

    const res = await postSwitchGroup(app, { groupId: 'group-1' });

    expect(res.status).toBe(200);
    // Only requireAuth looks a membership up directly; the handler reuses the
    // list it needs for the response body.
    expect(mockGetMembership).toHaveBeenCalledTimes(1);
    expect(mockGetUserMemberships).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when groupId is missing', async () => {
    authenticate();

    const res = await postSwitchGroup(app, {});

    expect(res.status).toBe(400);
    expect(mockGetUserMemberships).not.toHaveBeenCalled();
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 404 when the authenticated user no longer exists', async () => {
    authenticate();
    mockGetUserMemberships.mockResolvedValue([membership()]);
    mockGetUserById.mockResolvedValue(null);

    const res = await postSwitchGroup(app, { groupId: 'group-1' });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('User not found');
  });
});

describe('POST /auth/select-group', () => {
  let app: Hono;

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: the latter clears call history but
    // leaves implementations in place, so a test that forgot a stub would
    // silently inherit the previous test's and pass only in order.
    vi.resetAllMocks();
    app = createApp();
    mockGenerateAccessToken.mockResolvedValue('new-access-token');
    mockGenerateRefreshToken.mockResolvedValue('new-refresh-token');
    mockReissueSession.mockResolvedValue({ jti: 'jti-1', familyId: 'family-1' });
    mockGetUserById.mockResolvedValue(user);
  });

  function postSelectGroup(body: unknown) {
    return app.request('/auth/select-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 for an invalid or expired selection token', async () => {
    mockVerifyGroupSelectionToken.mockResolvedValue({ valid: false });

    const res = await postSelectGroup({ selectionToken: 'bad', groupId: 'group-1' });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Invalid or expired selection token');
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('returns 403 when the token holder is not a member of the chosen group', async () => {
    mockVerifyGroupSelectionToken.mockResolvedValue({ valid: true, userId: 'user-1' });
    mockGetUserMemberships.mockResolvedValue([membership()]);

    const res = await postSelectGroup({ selectionToken: 'good', groupId: 'group-99' });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('You are not a member of this group');
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('issues a session for the chosen group without an access token', async () => {
    // This is the group-picker path: the caller has no access token yet, only
    // the selection token, so the endpoint must not require authentication.
    mockVerifyGroupSelectionToken.mockResolvedValue({ valid: true, userId: 'user-1' });
    mockGetUserMemberships.mockResolvedValue([
      membership({ group_id: 'group-2', role: 'admin', group_name: 'Group Two' }),
    ]);

    const res = await postSelectGroup({ selectionToken: 'good', groupId: 'group-2' });

    expect(res.status).toBe(200);
    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      'user-1',
      'group-2',
      'admin',
      'test-secret'
    );
    const json = (await res.json()) as { accessToken: string; currentGroup: { id: string } };
    expect(json.accessToken).toBe('new-access-token');
    expect(json.currentGroup.id).toBe('group-2');

    // The picker flow depends on this cookie for the session that follows.
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('refreshToken=new-refresh-token');
    expect(cookie).toContain('HttpOnly');
  });
});
