import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyJWT = vi.fn();
const mockGetMembership = vi.fn();
const mockCreatePushSubscription = vi.fn();
const mockCreateDeviceToken = vi.fn();
const mockCountUserDeviceTokensSince = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getGroup: vi.fn(),
  createPushSubscription: (...args: unknown[]) => mockCreatePushSubscription(...args),
  deletePushSubscriptionForGroup: vi.fn(),
  deleteAllPushSubscriptionsForEndpointWithToken: vi.fn(),
  getUserPushSubscriptionsForGroup: vi.fn(),
  createDeviceToken: (...args: unknown[]) => mockCreateDeviceToken(...args),
  deleteDeviceToken: vi.fn(),
  getDeviceToken: vi.fn(),
  countUserDeviceTokensSince: (...args: unknown[]) => mockCountUserDeviceTokensSince(...args),
}));

vi.mock('../lib/fcm', () => ({
  configureFcm: vi.fn(),
  isFcmConfigured: vi.fn(() => false),
  sendFcmNotification: vi.fn(),
}));

import push from './push';
import { errorHandler } from '../lib/errorHandler';

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET: 'test-secret', DB: {} };
    await next();
  });
  app.route('/push', push);
  app.onError(errorHandler);
  return app;
}

function authedPost(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('push validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  describe('POST /push/subscribe', () => {
    it('returns 400 for an invalid subscription (missing keys)', async () => {
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'https://push.example.com/abc',
      });

      expect(res.status).toBe(400);
      expect(mockCreatePushSubscription).not.toHaveBeenCalled();
    });

    it('returns 400 when the endpoint is not a URL', async () => {
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'not-a-url',
        keys: { p256dh: 'a', auth: 'b' },
      });

      expect(res.status).toBe(400);
      expect(mockCreatePushSubscription).not.toHaveBeenCalled();
    });

    it('accepts a valid subscription', async () => {
      mockCreatePushSubscription.mockResolvedValue({ id: 'sub-1', deletionToken: 'tok' });
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as { deletionToken: string };
      expect(json.deletionToken).toBe('tok');
    });
  });

  describe('POST /push/device', () => {
    it('returns 400 for an invalid platform', async () => {
      const app = createApp();
      const res = await authedPost(app, '/push/device', {
        platform: 'windows',
        token: 'device-token',
      });

      expect(res.status).toBe(400);
      expect(mockCreateDeviceToken).not.toHaveBeenCalled();
    });

    it('registers a valid device token', async () => {
      mockCountUserDeviceTokensSince.mockResolvedValue(0);
      mockCreateDeviceToken.mockResolvedValue(undefined);
      const app = createApp();
      const res = await authedPost(app, '/push/device', {
        platform: 'ios',
        token: 'device-token',
      });

      expect(res.status).toBe(201);
      expect(mockCreateDeviceToken).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'group-1',
        'ios',
        'device-token'
      );
    });
  });
});
