import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { COMMENT_MAX_LENGTH, CAPTION_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetPhoto = vi.fn();
const mockGetPhotoWithCounts = vi.fn();
const mockGetResolvedMemberName = vi.fn();
const mockGetGroupPushSubscriptions = vi.fn();
const mockSendPushNotifications = vi.fn();
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
  getPhotoWithCounts: (...args: unknown[]) => mockGetPhotoWithCounts(...args),
  listPhotosWithCounts: vi.fn(),
  deletePhoto: vi.fn(),
  recordPhotoView: vi.fn(),
  getPhotoViewers: vi.fn(),
  addPhotoReaction: (...args: unknown[]) => mockAddPhotoReaction(...args),
  removePhotoReaction: (...args: unknown[]) => mockRemovePhotoReaction(...args),
  getPhotoReactionsWithUsers: vi.fn(),
  getGroupPushSubscriptions: (...args: unknown[]) => mockGetGroupPushSubscriptions(...args),
  getGroupDeviceTokens: vi.fn().mockResolvedValue([]),
  getGroup: vi.fn(),
  getResolvedMemberName: (...args: unknown[]) => mockGetResolvedMemberName(...args),
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  getCommentsByPhotoId: (...args: unknown[]) => mockGetCommentsByPhotoId(...args),
  getComment: vi.fn(),
  deleteComment: vi.fn(),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
}));

vi.mock('../lib/push', () => ({
  configureVapid: vi.fn(),
  sendPushNotifications: (...args: unknown[]) => mockSendPushNotifications(...args),
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

describe('GET /photos/:id', () => {
  it('returns a complete feed-shaped photo for a direct link', async () => {
    const app = createTestApp();
    authenticateAsMember();
    mockGetPhotoWithCounts.mockResolvedValue({
      id: 'older-photo',
      group_id: 'group-1',
      r2_key: 'photos/older.jpg',
      thumbnail_r2_key: 'thumbnails/older.jpg',
      caption: 'An older memory',
      uploaded_by: 'user-2',
      uploaded_at: 1000,
      uploader_name: 'Mum',
      uploader_profile_color: 'teal',
      comment_count: 2,
      reaction_count: 1,
      reactions: [{ emoji: '❤️', count: 1 }],
      user_reactions: [],
    });

    const res = await app.request('/photos/older-photo', { headers: authHeaders });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(mockGetPhotoWithCounts).toHaveBeenCalledWith({}, 'older-photo', 'group-1', 'user-1');
    expect(json).toMatchObject({
      id: 'older-photo',
      uploaderName: 'Mum',
      commentCount: 2,
      reactions: [{ emoji: '❤️', count: 1 }],
    });
  });

  it('returns 404 when the photo is not in the current group', async () => {
    const app = createTestApp();
    authenticateAsMember();
    mockGetPhotoWithCounts.mockResolvedValue(null);

    const res = await app.request('/photos/missing-photo', { headers: authHeaders });

    expect(res.status).toBe(404);
    expect(mockGetPhotoWithCounts).toHaveBeenCalledWith({}, 'missing-photo', 'group-1', 'user-1');
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

  it('uses Former member for an author who has left the group', async () => {
    // The account still exists, so this is not the deleted-user case; what is
    // gone is the membership the name resolved against. The snapshot in
    // author_name is the name this group saw at the time, which is what a
    // display-name override was for — the canonical name must not surface here.
    mockGetCommentsByPhotoId.mockResolvedValue([
      {
        id: 'comment-1',
        photo_id: 'photo-1',
        user_id: 'user-2',
        author_name: 'Mum',
        user_name: null,
        author_profile_color: 'teal',
        content: 'hello',
        created_at: 1000,
        deleted_at: null,
      },
    ]);

    const res = await app.request('/photos/photo-1/comments', { headers: authHeaders });

    const json = (await res.json()) as { comments: Array<{ authorName: string }> };
    expect(json.comments[0].authorName).toBe('Former member');
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
    expect(mockGetResolvedMemberName).not.toHaveBeenCalled();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it('snapshots the name this group sees, not the canonical one', async () => {
    authenticateAsMember();
    mockGetPhoto.mockResolvedValue({ id: 'photo-1', group_id: 'group-1' });
    mockGetResolvedMemberName.mockResolvedValue('Mum');
    mockCreateComment.mockResolvedValue('comment-1');

    const res = await app.request('/photos/photo-1/comments', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'hello' }),
    });

    expect(res.status).toBe(201);
    expect(mockGetResolvedMemberName).toHaveBeenCalledWith({}, 'user-1', 'group-1');
    // The snapshot is the fallback shown once the account is gone, so storing
    // the canonical name here would make old comments disagree with the
    // override the group sees everywhere else.
    expect(mockCreateComment).toHaveBeenCalledWith({}, 'photo-1', 'user-1', 'Mum', 'hello');
  });

  it('refuses to comment when the author has no membership to resolve a name from', async () => {
    authenticateAsMember();
    mockGetPhoto.mockResolvedValue({ id: 'photo-1', group_id: 'group-1' });
    mockGetResolvedMemberName.mockResolvedValue(null);

    const res = await app.request('/photos/photo-1/comments', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'hello' }),
    });

    expect(res.status).toBe(404);
    expect(mockCreateComment).not.toHaveBeenCalled();
  });
});

describe('photo upload notifications', () => {
  let app: Hono;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    app = createTestApp({
      PHOTOS: { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn() },
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      FRONTEND_URL: 'https://photodrop.test',
    });
    authenticateAsAdmin();
    mockCreatePhoto.mockResolvedValue('photo-1');
    mockGetGroupPushSubscriptions.mockResolvedValue([{ endpoint: 'https://push.test/1' }]);
    mockSendPushNotifications.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('announces the uploader under the name their group knows them by', async () => {
    mockGetResolvedMemberName.mockResolvedValue('Mum Smith');

    const body = new FormData();
    body.set('photo', new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' }));
    body.set('thumbnail', new File([jpegBytes], 'thumb.jpg', { type: 'image/jpeg' }));

    const scheduled: Promise<unknown>[] = [];
    const res = await app.request(
      '/photos',
      { method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body },
      {},
      {
        waitUntil: (promise: Promise<unknown>) => scheduled.push(promise),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext
    );
    await Promise.all(scheduled);

    expect(res.status).toBe(201);
    expect(mockGetResolvedMemberName).toHaveBeenCalledWith({}, 'user-1', 'group-1');
    // Notifications are about this group, so a group display name has to win
    // over the uploader's canonical name here too.
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [{ endpoint: 'https://push.test/1' }],
      expect.objectContaining({ body: 'Mum added a new photo' }),
      {}
    );
  });

  it('falls back to a generic name when the uploader has no resolvable name', async () => {
    mockGetResolvedMemberName.mockResolvedValue(null);

    const body = new FormData();
    body.set('photo', new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' }));
    body.set('thumbnail', new File([jpegBytes], 'thumb.jpg', { type: 'image/jpeg' }));

    const scheduled: Promise<unknown>[] = [];
    await app.request(
      '/photos',
      { method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body },
      {},
      {
        waitUntil: (promise: Promise<unknown>) => scheduled.push(promise),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext
    );
    await Promise.all(scheduled);

    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: 'Someone added a new photo' }),
      {}
    );
  });

  it('still notifies the group when the uploader name lookup rejects', async () => {
    // Unguarded, this rejection would sink the whole background task: no push,
    // no FCM, no log — just an unhandled rejection.
    mockGetResolvedMemberName.mockRejectedValue(new Error('D1 unavailable'));

    const body = new FormData();
    body.set('photo', new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' }));
    body.set('thumbnail', new File([jpegBytes], 'thumb.jpg', { type: 'image/jpeg' }));

    const scheduled: Promise<unknown>[] = [];
    const res = await app.request(
      '/photos',
      { method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body },
      {},
      {
        waitUntil: (promise: Promise<unknown>) => scheduled.push(promise),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext
    );
    await expect(Promise.all(scheduled)).resolves.toBeDefined();

    expect(res.status).toBe(201);
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: 'Someone added a new photo' }),
      {}
    );
    expect(consoleSpy).toHaveBeenCalled();
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
