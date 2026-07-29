import { Hono } from 'hono';
import {
  createPushSubscription,
  countUserPushSubscriptionsForGroup,
  deletePushSubscriptionForGroup,
  deleteAllPushSubscriptionsForEndpointWithToken,
  getUserPushSubscriptionsForGroup,
  createDeviceToken,
  deleteDeviceTokenForOtherUsers,
  deleteUserDeviceTokensForToken,
  getDeviceToken,
  countUserDeviceTokensSince,
} from '../lib/db';
import { configureFcm, isFcmConfigured, sendFcmNotification } from '../lib/fcm';
import { requireAuth } from '../middleware/auth';
import { createRateLimitMiddleware, rateLimitKeys } from '../middleware/rateLimit';
import {
  subscribeSchema,
  unsubscribeSchema,
  unsubscribeFromGroupSchema,
  registerDeviceSchema,
  deviceTokenSchema,
} from '../lib/schemas';
import { BadRequestError, NotFoundError, ForbiddenError, parseJsonBody } from '../lib/http';
import type {
  VapidPublicKeyResponse,
  PushSubscribedResponse,
  PushStatusResponse,
  DeviceStatusResponse,
} from '@photodrop/common/apiTypes';
import type { AppEnv } from '../types';

// Rate limit: max new device token registrations per user per hour
const DEVICE_REGISTRATION_LIMIT = 10;
const DEVICE_REGISTRATION_WINDOW_SECONDS = 60 * 60; // 1 hour

// Every stored subscription becomes an outbound fetch() on every upload, so the
// number a single member can register is bounded twice: by how fast they can
// register them, and by how many may exist for one group at a time. Without
// both, a member could register enough attacker-controlled endpoints to exhaust
// the Worker's subrequest budget and to leak uploader names and captions to
// arbitrary hosts.
const MAX_SUBSCRIPTIONS_PER_USER_GROUP = 20;

const subscribeRateLimit = createRateLimitMiddleware({
  maxRequests: 10,
  windowSeconds: 60 * 60, // 1 hour
  keyFn: rateLimitKeys.byUserId('push-subscribe'),
});

const push = new Hono<AppEnv>();

push.get('/vapid-public-key', (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return c.json({ error: 'Push notifications not configured' }, 500);
  }
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({ publicKey } satisfies VapidPublicKeyResponse);
});

push.post('/subscribe', requireAuth, subscribeRateLimit, async (c) => {
  const user = c.get('user');
  const { endpoint, keys } = await parseJsonBody(c, subscribeSchema);

  const existingCount = await countUserPushSubscriptionsForGroup(
    c.env.DB,
    user.id,
    user.groupId,
    endpoint
  );
  if (existingCount >= MAX_SUBSCRIPTIONS_PER_USER_GROUP) {
    throw new BadRequestError(
      `You already have the maximum of ${MAX_SUBSCRIPTIONS_PER_USER_GROUP} push subscriptions for this group`
    );
  }

  const result = await createPushSubscription(
    c.env.DB,
    user.id,
    user.groupId,
    endpoint,
    keys.p256dh,
    keys.auth
  );

  if ('error' in result) {
    // Another account already owns this endpoint for the group. Taking it over
    // would hand its notifications — and a fresh deletion token — to whoever
    // asked last, so refuse instead.
    throw new ForbiddenError('This push endpoint is registered to another account');
  }

  return c.json(
    {
      message: 'Subscribed successfully',
      deletionToken: result.deletionToken,
    } satisfies PushSubscribedResponse,
    201
  );
});

// Unauthenticated by design: used during logout cleanup, after the session may
// already be gone. The deletion token proves ownership of the endpoint.
push.delete('/unsubscribe', async (c) => {
  const { endpoint, deletionToken } = await parseJsonBody(c, unsubscribeSchema);

  const { tokenValid } = await deleteAllPushSubscriptionsForEndpointWithToken(
    c.env.DB,
    endpoint,
    deletionToken
  );

  if (!tokenValid) {
    throw new ForbiddenError('Invalid deletion token');
  }

  return c.json({ message: 'Unsubscribed successfully' });
});

push.delete('/subscribe', requireAuth, async (c) => {
  const user = c.get('user');
  const { endpoint } = await parseJsonBody(c, unsubscribeFromGroupSchema);

  await deletePushSubscriptionForGroup(c.env.DB, user.id, user.groupId, endpoint);

  return c.json({ message: 'Unsubscribed successfully' });
});

push.get('/status', requireAuth, async (c) => {
  const user = c.get('user');
  const endpoint = c.req.query('endpoint');

  if (!endpoint) {
    throw new BadRequestError('Endpoint query parameter is required');
  }

  const subscriptions = await getUserPushSubscriptionsForGroup(c.env.DB, user.id, user.groupId);
  const isSubscribed = subscriptions.some((sub) => sub.endpoint === endpoint);

  return c.json({ subscribed: isSubscribed } satisfies PushStatusResponse);
});

// Native push notification device token routes

push.post('/device', requireAuth, async (c) => {
  const user = c.get('user');
  const { platform, token } = await parseJsonBody(c, registerDeviceSchema);

  // Rate limit: check how many new tokens this user has registered recently
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - DEVICE_REGISTRATION_WINDOW_SECONDS;
  const recentCount = await countUserDeviceTokensSince(c.env.DB, user.id, windowStart);

  if (recentCount >= DEVICE_REGISTRATION_LIMIT) {
    return c.json({ error: 'Too many device registrations. Please try again later.' }, 429);
  }

  // Registering the token asserts this device now belongs to the caller, so any
  // rows another account still holds for it must go first: otherwise the person
  // signing in second keeps receiving the first user's notifications, including
  // for groups they are not a member of.
  await deleteDeviceTokenForOtherUsers(c.env.DB, user.id, token);

  await createDeviceToken(c.env.DB, user.id, user.groupId, platform, token);

  return c.json({ message: 'Device registered successfully' }, 201);
});

push.delete('/device', requireAuth, async (c) => {
  const user = c.get('user');
  const { token } = await parseJsonBody(c, deviceTokenSchema);

  // Unregistering is a device-level action (it happens on logout), so it clears
  // the caller's rows for this token in every group, not just the current one.
  await deleteUserDeviceTokensForToken(c.env.DB, user.id, token);

  return c.json({ message: 'Device unregistered successfully' });
});

push.get('/device/status', requireAuth, async (c) => {
  const user = c.get('user');
  const token = c.req.query('token');

  if (!token) {
    throw new BadRequestError('Token query parameter is required');
  }

  const deviceToken = await getDeviceToken(c.env.DB, user.id, user.groupId, token);

  return c.json({ registered: deviceToken !== null } satisfies DeviceStatusResponse);
});

// Test notification endpoint - sends a test push to the requesting device
push.post('/test', requireAuth, async (c) => {
  const user = c.get('user');
  const { token } = await parseJsonBody(c, deviceTokenSchema);

  // Check if FCM is configured
  if (!c.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('FCM not configured: FIREBASE_SERVICE_ACCOUNT secret not set');
    return c.json({ error: 'Push notifications not configured on server' }, 500);
  }

  if (!isFcmConfigured()) {
    configureFcm(c.env.FIREBASE_SERVICE_ACCOUNT);
  }

  // Get device token from DB
  const deviceToken = await getDeviceToken(c.env.DB, user.id, user.groupId, token);

  if (!deviceToken) {
    throw new NotFoundError('Device not registered');
  }

  // Send test notification
  const result = await sendFcmNotification(
    deviceToken,
    {
      title: '🔔 Test Notification',
      body: 'If you see this, push notifications are working!',
      data: { test: 'true' },
    },
    c.env.DB
  );

  if (result.success) {
    return c.json({ success: true, message: 'Test notification sent!' });
  } else if (result.removed) {
    return c.json({ error: 'Invalid token - device has been unregistered' }, 400);
  } else {
    return c.json({ error: 'Failed to send notification' }, 500);
  }
});

export default push;
