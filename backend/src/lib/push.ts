import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscription } from './db';
import { deletePushSubscription } from './db';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    groupId?: string;
    photoId?: string;
  };
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let vapidConfig: VapidConfig | null = null;

export function configureVapid(publicKey: string, privateKey: string, subject: string) {
  if (
    vapidConfig &&
    vapidConfig.publicKey === publicKey &&
    vapidConfig.privateKey === privateKey &&
    vapidConfig.subject === subject
  ) {
    return;
  }
  vapidConfig = { publicKey, privateKey, subject };
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  db: D1Database
): Promise<{ success: boolean; removed?: boolean }> {
  if (!vapidConfig) {
    throw new Error('VAPID not configured');
  }

  try {
    console.log('Sending push notification to:', subscription.endpoint.substring(0, 60) + '...');

    const message = {
      data: JSON.stringify(payload),
      options: { ttl: 86400, urgency: 'normal' as const },
    };

    const librarySubscription = {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    const fetchOptions = await buildPushPayload(message, librarySubscription, {
      subject: vapidConfig.subject,
      publicKey: vapidConfig.publicKey,
      privateKey: vapidConfig.privateKey,
    });

    const response = await fetch(subscription.endpoint, fetchOptions);

    if (response.ok || response.status === 201) {
      console.log('Push notification sent successfully');
      return { success: true };
    }

    console.error('Push notification failed:', response.status, await response.text());

    if (response.status === 404 || response.status === 410) {
      await deletePushSubscription(db, subscription.endpoint);
      return { success: false, removed: true };
    }

    return { success: false };
  } catch (error) {
    console.error('Push notification error:', error);
    return { success: false };
  }
}

export async function sendPushNotifications(
  subscriptions: PushSubscription[],
  payload: PushPayload,
  db: D1Database
): Promise<{ sent: number; failed: number; removed: number }> {
  let sent = 0;
  let failed = 0;
  let removed = 0;

  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushNotification(sub, payload, db))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        sent++;
      } else if (result.value.removed) {
        removed++;
      } else {
        failed++;
      }
    } else {
      failed++;
    }
  }

  return { sent, failed, removed };
}
