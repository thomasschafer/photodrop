import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { COMMENT_MAX_LENGTH, CAPTION_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetPhoto = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateComment = vi.fn();
const mockGetCommentsByPhotoId = vi.fn();
const mockCreatePhoto = vi.fn();
const mockAddPhotoReaction = vi.fn();
const mockRemovePhotoReaction = vi.fn();
const mockGetMembership = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  createPhoto: (...args: unknown[]) => mockCreatePhoto(...args),
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
  getCommentsByPhotoId: (...args: unknown[]) => mockGetCommentsByPhotoId(...args),
  getComment: vi.fn(),
  deleteComment: vi.fn(),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
}));

import photos from './photos';
import { errorHandler } from '../lib/errorHandler';

function createTestApp(envOverrides: Record<string, unknown> = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET: 'test-secret',
      DB: {},
      ...envOverrides,
    };
    await next();
  });
  app.route('/photos', photos);
  // Same handler production registers; routes rely on it to format thrown
  // HttpErrors (e.g. validation failures) into JSON error responses.
  app.onError(errorHandler);
  return app;
}

function authenticateAsAdmin() {
  mockVerifyJWT.mockResolvedValue({
    sub: 'user-1',
    groupId: 'group-1',
    role: 'admin',
    type: 'access',
  });
  mockGetMembership.mockResolvedValue({
    user_id: 'user-1',
    group_id: 'group-1',
    role: 'admin',
    joined_at: 1000,
    image_protection: 1,
  });
}

function authenticateAsMember() {
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
  });
}

const authHeaders = {
  Authorization: 'Bearer valid-token',
  'Content-Type': 'application/json',
};

describe('POST /photos', () => {
  let app: Hono;
  let r2Put: ReturnType<typeof vi.fn>;
  let r2Delete: ReturnType<typeof vi.fn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Minimum length accepted by the magic-byte validator, with a JPEG signature.
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    r2Put = vi.fn().mockResolvedValue(undefined);
    r2Delete = vi.fn().mockResolvedValue(undefined);
    app = createTestApp({ PHOTOS: { put: r2Put, delete: r2Delete } });
    authenticateAsAdmin();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function upload(caption?: string) {
    const body = new FormData();
    body.set('photo', new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' }));
    body.set('thumbnail', new File([jpegBytes], 'thumb.jpg', { type: 'image/jpeg' }));
    if (caption !== undefined) {
      body.set('caption', caption);
    }

    return app.request('/photos', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body,
    });
  }

  it('returns 400 when the caption exceeds the shared maximum length', async () => {
    const res = await upload('a'.repeat(CAPTION_MAX_LENGTH + 1));

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe(`Caption must be ${CAPTION_MAX_LENGTH} characters or less`);
    expect(r2Put).not.toHaveBeenCalled();
    expect(mockCreatePhoto).not.toHaveBeenCalled();
  });

  it('keeps the R2 objects when the photo row has already been committed', async () => {
    mockCreatePhoto.mockResolvedValue('photo-1');

    // app.request provides no ExecutionContext, so scheduling the notification
    // work throws — the exact post-commit failure that used to delete the R2
    // objects out from under a committed row and 404 the photo forever.
    const res = await upload('a caption');

    expect(res.status).toBe(201);
    expect((await res.json()) as { id: string }).toMatchObject({ id: 'photo-1' });
    expect(mockCreatePhoto).toHaveBeenCalled();
    expect(r2Delete).not.toHaveBeenCalled();
    // Pin that the failure really happened after the commit, so this keeps
    // testing the recovery path rather than a clean upload.
    expect(consoleSpy).toHaveBeenCalledWith(
      'Photo upload succeeded but post-commit work failed:',
      expect.any(Error)
    );
  });

  it('cleans up both R2 objects when the row was never committed', async () => {
    mockCreatePhoto.mockRejectedValue(new Error('insert failed'));

    const res = await upload();

    expect(res.status).toBe(500);
    expect(r2Put).toHaveBeenCalledTimes(2);
    const uploadedKeys = r2Put.mock.calls.map((call) => call[0] as string);
    expect(r2Delete.mock.calls.map((call) => call[0] as string)).toEqual(uploadedKeys);
  });
});

describe('GET /photos/:id/comments', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    authenticateAsMember();
    mockGetPhoto.mockResolvedValue({ id: 'photo-1', group_id: 'group-1' });
  });

  it('distinguishes a deleted comment from a comment whose author was deleted', async () => {
    mockGetCommentsByPhotoId.mockResolvedValue([
      {
        id: 'comment-deleted',
        photo_id: 'photo-1',
        // Soft-deletion nulls user_id as well, so deleted_at is what tells the
        // two states apart.
        user_id: null,
        author_name: '[deleted]',
        user_name: null,
        author_profile_color: null,
        content: '[deleted]',
        created_at: 2000,
        deleted_at: 3000,
      },
      {
        id: 'comment-orphaned',
        photo_id: 'photo-1',
        user_id: null,
        author_name: 'Gone Away',
        user_name: null,
        author_profile_color: null,
        content: 'still here',
        created_at: 1000,
        deleted_at: null,
      },
    ]);

    const res = await app.request('/photos/photo-1/comments', { headers: authHeaders });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      comments: Array<{ id: string; authorName: string; isDeleted: boolean }>;
    };

    expect(json.comments[0]).toMatchObject({
      id: 'comment-deleted',
      isDeleted: true,
      authorName: '[deleted]',
    });
    expect(json.comments[1]).toMatchObject({
      id: 'comment-orphaned',
      isDeleted: false,
      authorName: 'Deleted user',
    });
  });

  it('prefers the author current name for a live comment', async () => {
    mockGetCommentsByPhotoId.mockResolvedValue([
      {
        id: 'comment-1',
        photo_id: 'photo-1',
        user_id: 'user-2',
        author_name: 'Old Name',
        user_name: 'New Name',
        author_profile_color: 'teal',
        content: 'hello',
        created_at: 1000,
        deleted_at: null,
      },
    ]);

    const res = await app.request('/photos/photo-1/comments', { headers: authHeaders });

    const json = (await res.json()) as { comments: Array<{ authorName: string }> };
    expect(json.comments[0].authorName).toBe('New Name');
  });
});

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
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockAddPhotoReaction).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON without touching the database', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'POST',
      headers: authHeaders,
      body: '{"emoji":',
    });

    expect(res.status).toBe(400);
    expect(mockGetPhoto).not.toHaveBeenCalled();
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
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockRemovePhotoReaction).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON without touching the database', async () => {
    const res = await app.request('/photos/photo-1/react', {
      method: 'DELETE',
      headers: authHeaders,
      body: '{"emoji":',
    });

    expect(res.status).toBe(400);
    expect(mockGetPhoto).not.toHaveBeenCalled();
    expect(mockRemovePhotoReaction).not.toHaveBeenCalled();
  });
});
