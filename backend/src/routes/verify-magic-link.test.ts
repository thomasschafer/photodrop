import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock all dependencies
const mockVerifyMagicLink = vi.fn();
const mockMarkMagicLinkTokenPending = vi.fn();
const mockMarkMagicLinkTokenUsed = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateUser = vi.fn();
const mockGetMembership = vi.fn();
const mockCreateMembership = vi.fn();
const mockGetUserMemberships = vi.fn();
const mockGetGroup = vi.fn();
const mockCreateMagicLinkToken = vi.fn();
const mockGenerateAccessToken = vi.fn();
const mockGenerateRefreshToken = vi.fn();
const mockGenerateGroupSelectionToken = vi.fn();
const mockSendLoginLinkEmail = vi.fn();
const mockReissueSession = vi.fn();

vi.mock('../lib/magic-links', () => ({
  verifyMagicLink: (...args: unknown[]) => mockVerifyMagicLink(...args),
}));

vi.mock('../lib/db', () => ({
  markMagicLinkTokenPending: (...args: unknown[]) => mockMarkMagicLinkTokenPending(...args),
  markMagicLinkTokenUsed: (...args: unknown[]) => mockMarkMagicLinkTokenUsed(...args),
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  createMembership: (...args: unknown[]) => mockCreateMembership(...args),
  getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
  createMagicLinkToken: (...args: unknown[]) => mockCreateMagicLinkToken(...args),
}));

vi.mock('../lib/jwt', () => ({
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
  generateRefreshToken: (...args: unknown[]) => mockGenerateRefreshToken(...args),
  generateGroupSelectionToken: (...args: unknown[]) => mockGenerateGroupSelectionToken(...args),
  verifyJWT: vi.fn(),
  verifyGroupSelectionToken: vi.fn(),
  REFRESH_TOKEN_TTL_SECONDS: 30 * 24 * 60 * 60,
}));

// Session storage is exercised end-to-end in auth-sessions.test.ts; these tests
// only need the magic link flows to get a session to bind their token to.
vi.mock('../lib/sessions', () => ({
  reissueSession: (...args: unknown[]) => mockReissueSession(...args),
  refreshSession: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock('../lib/email', () => ({
  sendInviteEmail: vi.fn(),
  sendLoginLinkEmail: (...args: unknown[]) => mockSendLoginLinkEmail(...args),
}));

vi.mock('../middleware/rateLimit', () => ({
  createRateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  rateLimitKeys: { byUserId: () => () => '', byEmailFromBody: () => () => '' },
  getClientIP: () => '127.0.0.1',
}));

// Import auth routes after mocks
import auth from './auth';
import { errorHandler } from '../lib/errorHandler';

function createApp() {
  const app = new Hono();
  // Inject env bindings like other test files do
  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET: 'test-secret',
      DB: {},
      FRONTEND_URL: 'http://localhost:5173',
    };
    await next();
  });
  app.route('/auth', auth);
  // Same handler production registers; routes rely on it to format thrown
  // HttpErrors (e.g. validation failures) into JSON error responses.
  app.onError(errorHandler);
  return app;
}

const defaultUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  profile_color: 'terracotta',
  created_at: 1000,
  last_seen_at: null,
};

const defaultGroup = {
  id: 'group-1',
  name: 'Test Group',
  owner_id: 'user-1',
  created_at: 1000,
};

const defaultMembership = {
  user_id: 'user-1',
  group_id: 'group-1',
  role: 'member' as const,
  joined_at: 1000,
  group_name: 'Test Group',
  group_owner_id: 'user-1',
  image_protection: 0,
};

function makeInviteToken(overrides = {}) {
  return {
    token: 'valid-token',
    group_id: 'group-1',
    email: 'new@example.com',
    type: 'invite',
    invite_role: 'member',
    created_at: 1000,
    expires_at: 9999999999,
    used_at: null,
    pending_at: null,
    ...overrides,
  };
}

function makeLoginToken(overrides = {}) {
  return {
    token: 'valid-token',
    group_id: 'group-1',
    email: 'test@example.com',
    type: 'login',
    invite_role: null,
    created_at: 1000,
    expires_at: 9999999999,
    used_at: null,
    pending_at: null,
    ...overrides,
  };
}

async function postVerify(app: Hono, body: Record<string, unknown>, origin = 'http://localhost') {
  return app.request(`${origin}/auth/verify-magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postSendLoginLink(app: Hono, body: Record<string, unknown>) {
  return app.request('/auth/send-login-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('verify-magic-link endpoint', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockMarkMagicLinkTokenPending.mockResolvedValue(true);
    mockMarkMagicLinkTokenUsed.mockResolvedValue(true);
    mockGenerateAccessToken.mockResolvedValue('access-token');
    mockGenerateRefreshToken.mockResolvedValue('refresh-token');
    mockGenerateGroupSelectionToken.mockResolvedValue('selection-token');
    mockReissueSession.mockResolvedValue({ jti: 'jti-1', familyId: 'family-1' });
  });

  // --- Invalid token cases ---

  it('returns 400 for invalid token', async () => {
    mockVerifyMagicLink.mockResolvedValue({ valid: false, error: 'not_found' });

    const res = await postVerify(app, { token: 'bad-token' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Invalid token');
  });

  it('returns 400 for expired token', async () => {
    mockVerifyMagicLink.mockResolvedValue({ valid: false, error: 'expired' });

    const res = await postVerify(app, { token: 'expired-token' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Token has expired');
  });

  it('returns 400 for already used token', async () => {
    mockVerifyMagicLink.mockResolvedValue({ valid: false, error: 'already_used' });

    const res = await postVerify(app, { token: 'used-token' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Token has already been used');
  });

  it('returns 400 for pending token (race condition)', async () => {
    mockVerifyMagicLink.mockResolvedValue({ valid: false, error: 'pending' });

    const res = await postVerify(app, { token: 'pending-token' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('already being processed');
  });

  it('returns 400 when markPending fails (concurrent use)', async () => {
    const token = makeInviteToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockMarkMagicLinkTokenPending.mockResolvedValue(false);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('already being used');
  });

  // --- Invite flow: new user ---

  it('returns needsName when new user has no name', async () => {
    const token = makeInviteToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(null);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { needsName: boolean; email: string };
    expect(json.needsName).toBe(true);
    expect(json.email).toBe('new@example.com');
    // Token should NOT be marked as used yet
    expect(mockMarkMagicLinkTokenUsed).not.toHaveBeenCalled();
  });

  it('creates user and membership for new invite with name', async () => {
    const token = makeInviteToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue('new-user-id');
    mockGetUserById.mockResolvedValue({
      ...defaultUser,
      id: 'new-user-id',
      name: 'New User',
      email: 'new@example.com',
    });
    mockGetMembership.mockResolvedValue(null);
    mockCreateMembership.mockResolvedValue(undefined);
    mockGetUserMemberships.mockResolvedValue([
      { ...defaultMembership, user_id: 'new-user-id', role: 'member' },
    ]);
    mockGetGroup.mockResolvedValue(defaultGroup);

    const res = await postVerify(app, { token: 'valid-token', name: 'New User' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      accessToken: string;
      user: { name: string };
      needsGroupSelection: boolean;
    };

    expect(json.accessToken).toBe('access-token');
    expect(json.user.name).toBe('New User');
    expect(json.needsGroupSelection).toBe(false);
    expect(mockCreateUser).toHaveBeenCalledWith(expect.anything(), 'New User', 'new@example.com');
    expect(mockCreateMembership).toHaveBeenCalledWith(
      expect.anything(),
      'new-user-id',
      'group-1',
      'member'
    );
    expect(mockMarkMagicLinkTokenUsed).toHaveBeenCalled();
  });

  it('returns 400 for invite without invite_role', async () => {
    const token = makeInviteToken({ invite_role: null });
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(null);

    const res = await postVerify(app, { token: 'valid-token', name: 'Test' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Invalid invite token');
  });

  // --- Invite flow: existing user ---

  it('adds existing user to new group on invite', async () => {
    const token = makeInviteToken({ email: 'test@example.com' });
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetMembership.mockResolvedValue(null);
    mockCreateMembership.mockResolvedValue(undefined);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);
    mockGetGroup.mockResolvedValue(defaultGroup);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { accessToken: string };
    expect(json.accessToken).toBe('access-token');
    expect(mockCreateMembership).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('skips membership creation if already a member', async () => {
    const token = makeInviteToken({ email: 'test@example.com' });
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetMembership.mockResolvedValue(defaultMembership);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);
    mockGetGroup.mockResolvedValue(defaultGroup);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    expect(mockCreateMembership).not.toHaveBeenCalled();
  });

  // --- Login flow ---

  it('logs in user with single group', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      accessToken: string;
      needsGroupSelection: boolean;
      currentGroup: { id: string };
    };
    expect(json.accessToken).toBe('access-token');
    expect(json.needsGroupSelection).toBe(false);
    expect(json.currentGroup.id).toBe('group-1');
    expect(mockMarkMagicLinkTokenUsed).toHaveBeenCalled();
  });

  it('returns group selection for multi-group user', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([
      defaultMembership,
      { ...defaultMembership, group_id: 'group-2', group_name: 'Group 2' },
    ]);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      accessToken: null;
      needsGroupSelection: boolean;
      selectionToken: string;
      groups: unknown[];
    };
    expect(json.accessToken).toBeNull();
    expect(json.needsGroupSelection).toBe(true);
    expect(json.selectionToken).toBe('selection-token');
    expect(json.groups).toHaveLength(2);
  });

  it('handles user with zero groups on login', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([]);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      accessToken: null;
      needsGroupSelection: boolean;
      groups: unknown[];
    };
    expect(json.accessToken).toBeNull();
    expect(json.needsGroupSelection).toBe(false);
    expect(json.groups).toEqual([]);
  });

  it('returns 400 when login user not found', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(null);

    const res = await postVerify(app, { token: 'valid-token' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('User not found');
  });

  // --- Name submission flow (second request) ---

  // The pending state is only bypassed for the genuine second leg of the invite
  // flow, which the handler recognises from the token's own state. Deriving it
  // from the request body would let any caller opt out of the pending and
  // single-use guards just by sending a name.
  function pendingToken(token: Record<string, unknown>) {
    mockVerifyMagicLink.mockImplementation(
      (_db: unknown, _token: unknown, allowPending?: boolean) =>
        allowPending
          ? Promise.resolve({ valid: true, token })
          : Promise.resolve({ valid: false, error: 'pending', token })
    );
  }

  it('resumes a pending invite token for a name submission', async () => {
    pendingToken(makeInviteToken());
    mockGetUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue('new-user-id');
    mockGetUserById.mockResolvedValue({
      ...defaultUser,
      id: 'new-user-id',
      name: 'New User',
      email: 'new@example.com',
    });
    mockGetMembership.mockResolvedValue(null);
    mockCreateMembership.mockResolvedValue(undefined);
    mockGetUserMemberships.mockResolvedValue([{ ...defaultMembership, user_id: 'new-user-id' }]);
    mockGetGroup.mockResolvedValue(defaultGroup);
    // The first request marked the token pending, so this one cannot.
    mockMarkMagicLinkTokenPending.mockResolvedValue(false);

    const res = await postVerify(app, { token: 'valid-token', name: 'New User' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { accessToken: string };
    expect(json.accessToken).toBe('access-token');
    expect(mockVerifyMagicLink).toHaveBeenCalledWith(expect.anything(), 'valid-token', true);
  });

  it('does not let a name in the body bypass the pending guard on a login token', async () => {
    pendingToken(makeLoginToken());
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);
    mockMarkMagicLinkTokenPending.mockResolvedValue(false);

    const res = await postVerify(app, { token: 'valid-token', name: 'Any Name' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('already being processed');
    expect(mockVerifyMagicLink).not.toHaveBeenCalledWith(expect.anything(), 'valid-token', true);
    expect(mockMarkMagicLinkTokenUsed).not.toHaveBeenCalled();
  });

  it('does not resume a pending invite whose email already has an account', async () => {
    // An account already exists, so this token cannot be waiting on a name and
    // the pending state must be respected.
    pendingToken(makeInviteToken({ email: 'test@example.com' }));
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);

    const res = await postVerify(app, { token: 'valid-token', name: 'Any Name' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('already being processed');
    expect(mockMarkMagicLinkTokenUsed).not.toHaveBeenCalled();
  });

  // --- Single-use enforcement ---

  it('returns 400 when a concurrent request consumed the login token first', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);
    // The consume is atomic, so the loser of the race sees no rows changed.
    mockMarkMagicLinkTokenUsed.mockResolvedValue(false);

    const res = await postVerify(app, { token: 'valid-token' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Token has already been used');
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('does not create a user when a concurrent request consumed the invite token first', async () => {
    const token = makeInviteToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(null);
    mockMarkMagicLinkTokenUsed.mockResolvedValue(false);

    const res = await postVerify(app, { token: 'valid-token', name: 'New User' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Token has already been used');
    // Bailing out before the insert is what stops two redemptions racing into a
    // duplicate account (a UNIQUE violation) or a second session.
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockCreateMembership).not.toHaveBeenCalled();
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  // --- Refresh cookie attributes ---

  it('omits Secure on a plain-HTTP request so WebKit stores the refresh cookie', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);

    const res = await postVerify(app, { token: 'valid-token' }, 'http://localhost:8787');

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('refreshToken=refresh-token');
    expect(setCookie).not.toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
  });

  it('sets Secure on an HTTPS request', async () => {
    const token = makeLoginToken();
    mockVerifyMagicLink.mockResolvedValue({ valid: true, token });
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);

    const res = await postVerify(app, { token: 'valid-token' }, 'https://api.example.com');

    expect(res.headers.get('Set-Cookie') ?? '').toContain('Secure');
  });

  // --- Validation ---

  it('rejects empty token', async () => {
    const res = await postVerify(app, { token: '' });
    expect(res.status).toBe(400);
    // Assert the body too, so this pins schema validation rather than passing
    // on a 400 thrown by some unrelated branch.
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/too small|at least 1/i);
    expect(mockVerifyMagicLink).not.toHaveBeenCalled();
  });
});

describe('logout endpoint', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // A cookie is only replaced when the clear matches the attributes it was set
  // with, so the two must derive Secure the same way.
  it.each([
    { origin: 'http://localhost:8787', secure: false },
    { origin: 'https://api.example.com', secure: true },
  ])('clears the cookie with matching attributes over $origin', async ({ origin, secure }) => {
    const res = await app.request(`${origin}/auth/logout`, { method: 'POST' });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('refreshToken=;');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie.includes('Secure')).toBe(secure);
  });
});

describe('send-login-link endpoint', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockCreateMagicLinkToken.mockResolvedValue('login-token');
    mockSendLoginLinkEmail.mockResolvedValue(undefined);
  });

  it('creates a login token with null group for users with no groups', async () => {
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([]);

    const res = await postSendLoginLink(app, { email: 'Test@Example.com' });

    expect(res.status).toBe(200);
    expect(mockCreateMagicLinkToken).toHaveBeenCalledWith(
      expect.anything(),
      null,
      'test@example.com',
      'login'
    );
    expect(mockSendLoginLinkEmail).toHaveBeenCalledWith(
      expect.anything(),
      'test@example.com',
      'Test User',
      'http://localhost:5173/auth/login-token'
    );
  });

  it('creates a group-scoped login token when the user has a group', async () => {
    mockGetUserByEmail.mockResolvedValue(defaultUser);
    mockGetUserMemberships.mockResolvedValue([defaultMembership]);

    const res = await postSendLoginLink(app, { email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(mockCreateMagicLinkToken).toHaveBeenCalledWith(
      expect.anything(),
      'group-1',
      'test@example.com',
      'login'
    );
  });
});
