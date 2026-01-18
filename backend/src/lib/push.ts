import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscription } from './db';
import { deletePushSubscription } from './db';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

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

  let lastError: Error | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${delayMs}ms delay`);
        await sleep(delayMs);
      }

      const fetchOptions = await buildPushPayload(message, librarySubscription, {
        subject: vapidConfig.subject,
        publicKey: vapidConfig.publicKey,
        privateKey: vapidConfig.privateKey,
      });

      const response = await fetch(subscription.endpoint, fetchOptions);

      if (response.ok || response.status === 201) {
        if (attempt > 0) {
          console.log(`Push notification sent successfully after ${attempt} retries`);
        }
        return { success: true };
      }

      lastStatus = response.status;

      if (response.status === 404 || response.status === 410) {
        await deletePushSubscription(db, subscription.endpoint);
        return { success: false, removed: true };
      }

      if (!isRetryableError(response.status)) {
        console.error('Push notification failed with non-retryable error:', response.status);
        return { success: false };
      }

      console.warn(`Push notification failed with retryable error: ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Push notification attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  console.error(
    `Push notification failed after ${MAX_RETRIES} retries.`,
    lastStatus ? `Last status: ${lastStatus}` : `Last error: ${lastError?.message}`
  );
  return { success: false };
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
