import { Hono } from 'hono';
import {
  createPushSubscription,
  deletePushSubscriptionForGroup,
  getUserPushSubscriptionsForGroup,
  type MembershipRole,
} from '../lib/db';
import { requireAuth } from '../middleware/auth';
import type { Bindings } from '../types';

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

    await createPushSubscription(c.env.DB, user.id, user.groupId, endpoint, keys.p256dh, keys.auth);

    return c.json({ message: 'Subscribed successfully' }, 201);
  } catch (error) {
    console.error('Error subscribing to push:', error);
    return c.json({ error: 'Failed to subscribe' }, 500);
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

export default push;
