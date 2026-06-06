import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { COMMENT_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetPhoto = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateComment = vi.fn();
const mockAddPhotoReaction = vi.fn();
const mockRemovePhotoReaction = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  createPhoto: vi.fn(),
  getPhoto: (...args: unknown[]) => mockGetPhoto(...args),
  listPhotosWithCounts: vi.fn(),
  deletePhoto: vi.fn(),
  recordPhotoView: vi.fn(),
  getPhotoViewers: vi.fn(),
  addPhotoReaction: (...args: unknown[]) => mockAddPhotoReaction(...args),
  removePhotoReaction: (...args: unknown[]) => mockRemovePhotoReaction(...args),
  getPhotoReactionsWithUsers: vi.fn(),
  getGroupPushSubscriptions: vi.fn(),
  getGroupDeviceTokens: vi.fn(),
  getGroup: vi.fn(),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  getCommentsByPhotoId: vi.fn(),
  getComment: vi.fn(),
  deleteComment: vi.fn(),
  getMembership: vi.fn(),
}));

import photos from './photos';

function createTestApp(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET: 'test-secret',
      DB: {},
    };
    await next();
  });
  app.route('/photos', photos);
  return app;
}

function authenticateAsMember() {
  mockVerifyJWT.mockResolvedValue({
    sub: 'user-1',
    groupId: 'group-1',
    role: 'member',
    type: 'access',
  });
}

const authHeaders = {
  Authorization: 'Bearer valid-token',
  'Content-Type': 'application/json',
};

describe('POST /photos/:id/comments', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('returns 400 when comment exceeds max length', async () => {
    authenticateAsMember();

    const res = await app.request('/photos/photo-1/comments', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'a'.repeat(COMMENT_MAX_LENGTH + 1) }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(`Comment must be ${COMMENT_MAX_LENGTH} characters or less`);
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });
});

describe('POST /photos/:id/react', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticateAsMember();
  });

  it('adds a reaction for a valid emoji', async () => {
    mockGetPhoto.mockResolvedValue({ id: 'photo-1', group_id: 'group-1' });

    const res = await app.request('/photos/photo-1/react', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ emoji: '❤️' }),
    });

    expect(res.status).toBe(200);
    expect(mockAddPhotoReaction).toHaveBeenCalledWith({}, 'photo-1', 'user-1', '❤️');
  });

  it('returns 400 for a disallowed emoji without touching the database', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ emoji: '🦄' }),
    });

    expect(res.status).toBe(400);
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockAddPhotoReaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing request body', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'POST',
      headers: authHeaders,
    });

    expect(res.status).toBe(400);
    expect(mockAddPhotoReaction).not.toHaveBeenCalled();
  });
});

describe('DELETE /photos/:id/react', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticateAsMember();
  });

  it('removes a specific reaction for a valid emoji', async () => {
    mockGetPhoto.mockResolvedValue({ id: 'photo-1', group_id: 'group-1' });

    const res = await app.request('/photos/photo-1/react', {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ emoji: '🔥' }),
    });

    expect(res.status).toBe(200);
    expect(mockRemovePhotoReaction).toHaveBeenCalledWith({}, 'photo-1', 'user-1', '🔥');
  });

  it('returns 400 for a disallowed emoji without touching the database', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ emoji: '🦄' }),
    });

    expect(res.status).toBe(400);
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockRemovePhotoReaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing request body', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(res.status).toBe(400);
    expect(mockRemovePhotoReaction).not.toHaveBeenCalled();
  });
});
