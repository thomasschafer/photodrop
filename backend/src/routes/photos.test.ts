import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { COMMENT_MAX_LENGTH } from '@photodrop/common/limits';

const mockVerifyJWT = vi.fn();
const mockGetPhoto = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateComment = vi.fn();
const mockGetMembership = vi.fn();

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
  addPhotoReaction: vi.fn(),
  removePhotoReaction: vi.fn(),
  getPhotoReactionsWithUsers: vi.fn(),
  getGroupPushSubscriptions: vi.fn(),
  getGroupDeviceTokens: vi.fn(),
  getGroup: vi.fn(),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  getCommentsByPhotoId: vi.fn(),
  getComment: vi.fn(),
  deleteComment: vi.fn(),
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
}));

import photos from './photos';

describe('POST /photos/:id/comments', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembership.mockResolvedValue({
      user_id: 'user-1',
      group_id: 'group-1',
      role: 'member',
      joined_at: 1000,
      image_protection: 1,
    });

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = {
        JWT_SECRET: 'test-secret',
        DB: {},
      };
      await next();
    });
    app.route('/photos', photos);
  });

  it('returns 400 when comment exceeds max length', async () => {
    mockVerifyJWT.mockResolvedValue({
      sub: 'user-1',
      groupId: 'group-1',
      role: 'member',
      type: 'access',
    });

    const res = await app.request('/photos/photo-1/comments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
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
