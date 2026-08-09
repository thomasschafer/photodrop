import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyJWT = vi.fn();
const mockGetMembership = vi.fn();
const mockCreatePushSubscription = vi.fn();
const mockCountUserPushSubscriptionsForGroup = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('../lib/jwt', () => ({
  verifyJWT: (...args: unknown[]) => mockVerifyJWT(...args),
}));

vi.mock('../lib/db', () => ({
  getMembership: (...args: unknown[]) => mockGetMembership(...args),
  getGroup: vi.fn(),
  createPushSubscription: (...args: unknown[]) => mockCreatePushSubscription(...args),
  countUserPushSubscriptionsForGroup: (...args: unknown[]) =>
    mockCountUserPushSubscriptionsForGroup(...args),
  deletePushSubscriptionForGroup: vi.fn(),
  deleteAllPushSubscriptionsForEndpointWithToken: vi.fn(),
  getUserPushSubscriptionsForGroup: vi.fn(),
}));

// The rate limit middleware itself is deliberately left real: stubbing it out
// made removing it from a route chain invisible to these tests. Only its storage
// is mocked, so a test can drive the limiter to its 429.
vi.mock('../lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cleanupExpiredRateLimits: vi.fn(),
}));

import push from './push';
import { errorHandler } from '../lib/errorHandler';

// The limiter only engages in production, so everything except the rate limit
// tests runs with the default environment and is unaffected by it.
function createApp(env: Record<string, unknown> = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { JWT_SECRET: 'test-secret', DB: {}, ...env };
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
    mockCountUserPushSubscriptionsForGroup.mockResolvedValue(0);
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

    it('returns 400 for an over-long endpoint', async () => {
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: `https://push.example.com/${'a'.repeat(2100)}`,
        keys: { p256dh: 'key', auth: 'auth' },
      });

      expect(res.status).toBe(400);
      expect(mockCreatePushSubscription).not.toHaveBeenCalled();
    });

    it('refuses to take over an endpoint owned by another account', async () => {
      mockCreatePushSubscription.mockResolvedValue({ error: 'endpoint_owned_by_another_user' });
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });

      expect(res.status).toBe(403);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('This push endpoint is registered to another account');
    });

    it('refuses to register more than the per-group subscription cap', async () => {
      mockCountUserPushSubscriptionsForGroup.mockResolvedValue(20);
      const app = createApp();
      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });

      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('maximum of 20');
      expect(mockCreatePushSubscription).not.toHaveBeenCalled();
      // The cap counts the user's other endpoints, so re-subscribing an
      // already-registered one is never blocked by it.
      expect(mockCountUserPushSubscriptionsForGroup).toHaveBeenCalledWith(
        {},
        'user-1',
        'group-1',
        'https://push.example.com/abc'
      );
    });

    it('refuses a caller who has exhausted the hourly registration limit', async () => {
      // The other half of the two-sided defence: the per-group cap bounds how
      // many subscriptions can exist at once, this bounds how fast they can be
      // created. Driving the real middleware is what pins it to this route —
      // asserting only its configuration would not notice it leaving the chain.
      mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1_000_000 });
      const app = createApp({ ENVIRONMENT: 'production' });

      const res = await authedPost(app, '/push/subscribe', {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });

      expect(res.status).toBe(429);
      expect(mockCreatePushSubscription).not.toHaveBeenCalled();
      // 10 per hour, keyed by the authenticated user: a per-IP key would punish
      // a whole household, and the window is what makes the cap meaningful.
      expect(mockCheckRateLimit).toHaveBeenCalledWith({}, 'push-subscribe:user-1', 10, 3600);
    });

    it('subscribes normally while the caller is under the hourly limit', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 1_000_000 });
      // The middleware's probabilistic cleanup needs an execution context the
      // test app has no reason to provide; this keeps it out of the way.
      // Restored in a finally: leaking this spy would pin Math.random() at 1
      // for every later test in the file if the assertion below fails.
      const random = vi.spyOn(Math, 'random').mockReturnValue(1);
      try {
        mockCreatePushSubscription.mockResolvedValue({ id: 'sub-1', deletionToken: 'tok' });
        const app = createApp({ ENVIRONMENT: 'production' });

        const res = await authedPost(app, '/push/subscribe', {
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'key', auth: 'auth' },
        });

        expect(res.status).toBe(201);
      } finally {
        random.mockRestore();
      }
    });
  });
});
