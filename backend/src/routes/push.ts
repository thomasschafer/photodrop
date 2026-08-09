import { Hono } from 'hono';
import {
  createPushSubscription,
  countUserPushSubscriptionsForGroup,
  deletePushSubscriptionForGroup,
  deleteAllPushSubscriptionsForEndpointWithToken,
  getUserPushSubscriptionsForGroup,
} from '../lib/db';
import { requireAuth } from '../middleware/auth';
import { createRateLimitMiddleware, rateLimitKeys } from '../middleware/rateLimit';
import { subscribeSchema, unsubscribeSchema, unsubscribeFromGroupSchema } from '../lib/schemas';
import { BadRequestError, ForbiddenError, parseJsonBody } from '../lib/http';
import type {
  VapidPublicKeyResponse,
  PushSubscribedResponse,
  PushStatusResponse,
} from '@photodrop/common/apiTypes';
import type { AppEnv } from '../types';

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

export default push;
