import { Hono } from 'hono';
import {
  createPushSubscription,
  deletePushSubscriptionForGroup,
  deleteAllPushSubscriptionsForEndpointWithToken,
  getUserPushSubscriptionsForGroup,
  createDeviceToken,
  deleteDeviceToken,
  getDeviceToken,
  countUserDeviceTokensSince,
  type MembershipRole,
  type DevicePlatform,
} from '../lib/db';
import { configureFcm, isFcmConfigured, sendFcmNotification } from '../lib/fcm';
import { requireAuth } from '../middleware/auth';
import type { Bindings } from '../types';

// Rate limit: max new device token registrations per user per hour
const DEVICE_REGISTRATION_LIMIT = 10;
const DEVICE_REGISTRATION_WINDOW_SECONDS = 60 * 60; // 1 hour

type Variables = {
  user: {
    id: string;
    groupId: string;
    role: MembershipRole;
  };
};

const push = new Hono<{ Bindings: Bindings; Variables: Variables }>();

push.get('/vapid-public-key', (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return c.json({ error: 'Push notifications not configured' }, 500);
  }
  return c.json({ publicKey });
});

push.post('/subscribe', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const { endpoint, keys } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return c.json({ error: 'Invalid subscription data' }, 400);
    }

    const { deletionToken } = await createPushSubscription(
      c.env.DB,
      user.id,
      user.groupId,
      endpoint,
      keys.p256dh,
      keys.auth
    );

    return c.json({ message: 'Subscribed successfully', deletionToken }, 201);
  } catch (error) {
    console.error('Error subscribing to push:', error);
    return c.json({ error: 'Failed to subscribe' }, 500);
  }
});

push.delete('/unsubscribe', async (c) => {
  try {
    const body = await c.req.json();
    const { endpoint, deletionToken } = body;

    if (!endpoint || !deletionToken) {
      return c.json({ error: 'Endpoint and deletionToken are required' }, 400);
    }

    const { success, tokenValid } = await deleteAllPushSubscriptionsForEndpointWithToken(
      c.env.DB,
      endpoint,
      deletionToken
    );

    if (!tokenValid) {
      return c.json({ error: 'Invalid deletion token' }, 403);
    }

    if (!success) {
      return c.json({ error: 'Failed to unsubscribe' }, 500);
    }

    return c.json({ message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Error unsubscribing by endpoint:', error);
    return c.json({ error: 'Failed to unsubscribe' }, 500);
  }
});

push.delete('/subscribe', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const { endpoint } = body;
    if (!endpoint) {
      return c.json({ error: 'Endpoint is required' }, 400);
    }

    await deletePushSubscriptionForGroup(c.env.DB, user.id, user.groupId, endpoint);

    return c.json({ message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    return c.json({ error: 'Failed to unsubscribe' }, 500);
  }
});

push.get('/status', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const endpoint = c.req.query('endpoint');

    if (!endpoint) {
      return c.json({ error: 'Endpoint query parameter is required' }, 400);
    }

    const subscriptions = await getUserPushSubscriptionsForGroup(c.env.DB, user.id, user.groupId);
    const isSubscribed = subscriptions.some((sub) => sub.endpoint === endpoint);

    return c.json({ subscribed: isSubscribed });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return c.json({ error: 'Failed to check status' }, 500);
  }
});

// Native push notification device token routes

push.post('/device', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const { platform, token } = body;

    if (!platform || !token) {
      return c.json({ error: 'Platform and token are required' }, 400);
    }

    if (platform !== 'ios' && platform !== 'android') {
      return c.json({ error: 'Platform must be ios or android' }, 400);
    }

    // Rate limit: check how many new tokens this user has registered recently
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - DEVICE_REGISTRATION_WINDOW_SECONDS;
    const recentCount = await countUserDeviceTokensSince(c.env.DB, user.id, windowStart);

    if (recentCount >= DEVICE_REGISTRATION_LIMIT) {
      return c.json({ error: 'Too many device registrations. Please try again later.' }, 429);
    }

    await createDeviceToken(c.env.DB, user.id, user.groupId, platform as DevicePlatform, token);

    return c.json({ message: 'Device registered successfully' }, 201);
  } catch (error) {
    console.error('Error registering device token:', error);
    return c.json({ error: 'Failed to register device' }, 500);
  }
});

push.delete('/device', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();

    const { token } = body;

    if (!token) {
      return c.json({ error: 'Token is required' }, 400);
    }

    await deleteDeviceToken(c.env.DB, user.id, user.groupId, token);

    return c.json({ message: 'Device unregistered successfully' });
  } catch (error) {
    console.error('Error unregistering device token:', error);
    return c.json({ error: 'Failed to unregister device' }, 500);
  }
});

push.get('/device/status', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const token = c.req.query('token');

    if (!token) {
      return c.json({ error: 'Token query parameter is required' }, 400);
    }

    const deviceToken = await getDeviceToken(c.env.DB, user.id, user.groupId, token);

    return c.json({ registered: deviceToken !== null });
  } catch (error) {
    console.error('Error checking device token status:', error);
    return c.json({ error: 'Failed to check status' }, 500);
  }
});

// Test notification endpoint - sends a test push to the requesting device
push.post('/test', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { token } = body;

    if (!token) {
      return c.json({ error: 'Token is required' }, 400);
    }

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
      return c.json({ error: 'Device not registered' }, 404);
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
  } catch (error) {
    console.error('Error sending test notification:', error);
    return c.json({ error: 'Failed to send test notification' }, 500);
  }
});

export default push;
