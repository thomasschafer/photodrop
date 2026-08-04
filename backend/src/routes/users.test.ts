import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { NAME_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetUserById = vi.fn();
const mockGetUserByEmail = vi.fn();
const mockGetUserMemberships = vi.fn();
const mockGetMembership = vi.fn();
const mockUpdateUserProfile = vi.fn();
const mockGetOwnedGroups = vi.fn();
const mockCreateAccountDeletionToken = vi.fn();
const mockGetAccountDeletionToken = vi.fn();
const mockAnonymizeUserAccount = vi.fn();
const mockSendAccountDeletionEmail = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
  getGroupMembers: vi.fn(),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getGroup: vi.fn(),
  updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args),
  getOwnedGroups: (...args: unknown[]) => mockGetOwnedGroups(...args),
  createAccountDeletionToken: (...args: unknown[]) => mockCreateAccountDeletionToken(...args),
  getAccountDeletionToken: (...args: unknown[]) => mockGetAccountDeletionToken(...args),
  anonymizeUserAccount: (...args: unknown[]) => mockAnonymizeUserAccount(...args),
}));

vi.mock('../lib/email', () => ({
  sendAccountDeletionEmail: (...args: unknown[]) => mockSendAccountDeletionEmail(...args),
}));

import users from './users';
import { errorHandler } from '../lib/errorHandler';

const authHeaders = {
  Authorization: 'Bearer valid-token',
  'Content-Type': 'application/json',
};

const storedUser = {
  id: 'user-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  profile_color: 'teal',
  created_at: 1000,
  last_seen_at: 2000,
};

function membership(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    group_id: 'group-1',
    role: 'member',
    joined_at: 1000,
    image_protection: 1,
    display_name: null,
    group_name: 'Family',
    group_owner_id: 'owner-1',
    ...overrides,
  };
}

function createTestApp(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET: 'test-secret', DB: {}, FRONTEND_URL: 'http://localhost:5173' };
    await next();
  });
  app.route('/users', users);
  app.onError(errorHandler);
  return app;
}

function authenticate() {
  mockVerifyJWT.mockResolvedValue({
    sub: 'user-1',
    groupId: 'group-1',
    role: 'member',
    type: 'access',
  });
  mockGetMembership.mockResolvedValue({
    user_id: 'user-1',
    group_id: 'group-1',
    role: 'member',
    joined_at: 1000,
    image_protection: 1,
    display_name: null,
  });
}

describe('GET /users/me', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticate();
    mockGetUserById.mockResolvedValue(storedUser);
  });

  it('reports the canonical name alongside the display name in the current group', async () => {
    mockGetUserMemberships.mockResolvedValue([membership({ display_name: 'Mum' })]);

    const res = await app.request('/users/me', { headers: authHeaders });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { name: string; currentGroupDisplayName: string | null };
    // Outside a group context the account shows its canonical name; the
    // override is reported separately so the profile UI can show both.
    expect(json.name).toBe('Jane Doe');
    expect(json.currentGroupDisplayName).toBe('Mum');
  });

  it('reports a null display name when the user has no override in this group', async () => {
    mockGetUserMemberships.mockResolvedValue([membership()]);

    const res = await app.request('/users/me', { headers: authHeaders });

    const json = (await res.json()) as { currentGroupDisplayName: string | null };
    expect(json.currentGroupDisplayName).toBeNull();
  });

  it('reports a null display name when there is no membership of the current group', async () => {
    mockGetUserMemberships.mockResolvedValue([membership({ group_id: 'group-2' })]);

    const res = await app.request('/users/me', { headers: authHeaders });

    const json = (await res.json()) as {
      currentGroup: unknown;
      currentGroupDisplayName: string | null;
    };
    expect(json.currentGroup).toBeNull();
    expect(json.currentGroupDisplayName).toBeNull();
  });
});

describe('PATCH /users/me/profile', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticate();
    mockUpdateUserProfile.mockResolvedValue(true);
    mockGetUserById.mockResolvedValue(storedUser);
  });

  function patchProfile(body: unknown) {
    return app.request('/users/me/profile', {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(body),
    });
  }

  it('renames the caller, and only the caller', async () => {
    mockGetUserById.mockResolvedValue({ ...storedUser, name: 'Jane Smith' });

    const res = await patchProfile({ name: 'Jane Smith' });

    expect(res.status).toBe(200);
    // The route ignores any user id in the body: the rename is always applied
    // to the authenticated user, and only the field that was sent is written.
    expect(mockUpdateUserProfile).toHaveBeenCalledWith({}, 'user-1', {
      name: 'Jane Smith',
      profileColor: undefined,
    });
    const json = (await res.json()) as { name: string; profileColor: string };
    expect(json).toMatchObject({ name: 'Jane Smith', profileColor: 'teal' });
  });

  it('updates the profile color without touching the name', async () => {
    const res = await patchProfile({ profileColor: 'sage' });

    expect(res.status).toBe(200);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith({}, 'user-1', {
      name: undefined,
      profileColor: 'sage',
    });
  });

  it('updates both fields in one request, as a single write', async () => {
    const res = await patchProfile({ name: 'Jane Smith', profileColor: 'sage' });

    expect(res.status).toBe(200);
    // One call, not one per field: D1 cannot roll back the first write when the
    // second fails, so a 500 must never leave half the request applied.
    expect(mockUpdateUserProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith({}, 'user-1', {
      name: 'Jane Smith',
      profileColor: 'sage',
    });
  });

  it('rejects a body that would change nothing', async () => {
    const res = await patchProfile({});

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Provide at least one of name or profileColor to update');
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a blank name', async () => {
    const res = await patchProfile({ name: '   ' });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Name cannot be empty');
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects a name over the shared name limit', async () => {
    const res = await patchProfile({ name: 'a'.repeat(NAME_MAX_LENGTH + 1) });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(`Name must be ${NAME_MAX_LENGTH} characters or less`);
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('returns 500 when the rename changes no row', async () => {
    mockUpdateUserProfile.mockResolvedValue(false);

    const res = await patchProfile({ name: 'Jane Smith' });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Failed to update profile');
  });
});

describe('account deletion confirmation', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticate();
    mockGetUserById.mockResolvedValue({ ...storedUser, deleted_at: null });
    mockGetOwnedGroups.mockResolvedValue([]);
    mockCreateAccountDeletionToken.mockResolvedValue('delete-token');
    mockSendAccountDeletionEmail.mockResolvedValue(undefined);
  });

  it('emails a separate short-lived confirmation link', async () => {
    const res = await app.request('/users/me/account-deletion', {
      method: 'POST',
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    expect(mockCreateAccountDeletionToken).toHaveBeenCalledWith({}, 'user-1');
    expect(mockSendAccountDeletionEmail).toHaveBeenCalledWith(
      expect.anything(),
      'jane@example.com',
      'Jane Doe',
      'http://localhost:5173/delete-account/delete-token'
    );
  });

  it('blocks deletion while the person still owns a group', async () => {
    mockGetOwnedGroups.mockResolvedValue([
      { id: 'group-1', name: 'Family', owner_id: 'user-1', created_at: 1000 },
    ]);

    const res = await app.request('/users/me/account-deletion', {
      method: 'POST',
      headers: authHeaders,
    });

    expect(res.status).toBe(403);
    expect(mockCreateAccountDeletionToken).not.toHaveBeenCalled();
  });

  it('uses the emailed token to anonymize the account', async () => {
    mockGetAccountDeletionToken.mockResolvedValue({
      token: 'delete-token',
      user_id: 'user-1',
      created_at: 1000,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      used_at: null,
    });
    mockAnonymizeUserAccount.mockResolvedValue(true);

    const res = await app.request('/users/confirm-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'delete-token' }),
    });

    expect(res.status).toBe(200);
    expect(mockAnonymizeUserAccount).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: 'user-1' }),
      'delete-token'
    );
  });

  it('rejects expired and already-used confirmation tokens', async () => {
    mockGetAccountDeletionToken
      .mockResolvedValueOnce({
        token: 'delete-token',
        user_id: 'user-1',
        created_at: 1000,
        expires_at: Math.floor(Date.now() / 1000) - 1,
        used_at: null,
      })
      .mockResolvedValueOnce({
        token: 'delete-token',
        user_id: 'user-1',
        created_at: 1000,
        expires_at: Math.floor(Date.now() / 1000) + 300,
        used_at: 1100,
      });

    const expired = await app.request('/users/confirm-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'delete-token' }),
    });
    const used = await app.request('/users/confirm-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'delete-token' }),
    });

    expect(expired.status).toBe(400);
    expect(used.status).toBe(400);
    expect(mockAnonymizeUserAccount).not.toHaveBeenCalled();
  });

  it('blocks confirmation if the user became a group owner', async () => {
    mockGetAccountDeletionToken.mockResolvedValue({
      token: 'delete-token',
      user_id: 'user-1',
      created_at: 1000,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      used_at: null,
    });
    mockGetOwnedGroups.mockResolvedValue([
      { id: 'group-1', name: 'Family', owner_id: 'user-1', created_at: 1000 },
    ]);

    const res = await app.request('/users/confirm-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'delete-token' }),
    });

    expect(res.status).toBe(403);
    expect(mockAnonymizeUserAccount).not.toHaveBeenCalled();
  });

  it('reports a concurrent completed deletion as already deleted', async () => {
    mockGetAccountDeletionToken.mockResolvedValue({
      token: 'delete-token',
      user_id: 'user-1',
      created_at: 1000,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      used_at: null,
    });
    mockGetUserById
      .mockResolvedValueOnce({ ...storedUser, deleted_at: null })
      .mockResolvedValueOnce({ ...storedUser, deleted_at: 2000 });
    mockAnonymizeUserAccount.mockResolvedValue(false);

    const res = await app.request('/users/confirm-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'delete-token' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'This account has already been deleted',
    });
  });
});

describe('POST /users/request-account-deletion', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockCreateAccountDeletionToken.mockResolvedValue('delete-token');
    mockSendAccountDeletionEmail.mockResolvedValue(undefined);
  });

  const request = (email = 'jane@example.com') =>
    app.request('/users/request-account-deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

  it('returns the same response for unknown and ineligible accounts', async () => {
    mockGetUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...storedUser,
      deleted_at: null,
    });
    mockGetUserMemberships.mockResolvedValue([{ group_id: 'group-1' }]);

    const unknown = await request('unknown@example.com');
    const ineligible = await request();

    expect(unknown.status).toBe(200);
    expect(ineligible.status).toBe(200);
    expect(await unknown.text()).toBe(await ineligible.text());
    expect(mockSendAccountDeletionEmail).not.toHaveBeenCalled();
  });

  it('emails a confirmation only for a live account with no memberships', async () => {
    mockGetUserByEmail.mockResolvedValue({ ...storedUser, deleted_at: null });
    mockGetUserMemberships.mockResolvedValue([]);

    const res = await request();

    expect(res.status).toBe(200);
    expect(mockCreateAccountDeletionToken).toHaveBeenCalledWith({}, 'user-1');
    expect(mockSendAccountDeletionEmail).toHaveBeenCalledWith(
      expect.anything(),
      'jane@example.com',
      'Jane Doe',
      'http://localhost:5173/delete-account/delete-token'
    );
  });
});
