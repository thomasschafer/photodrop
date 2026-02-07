/**
 * Firebase Cloud Messaging (FCM) HTTP v1 API client
 * Sends push notifications to iOS and Android devices via FCM
 */

import type { DeviceToken } from './db';
import { deleteDeviceTokenByToken } from './db';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

interface FcmConfig {
  serviceAccount: ServiceAccount;
  accessToken?: string;
  tokenExpiry?: number;
}

let fcmConfig: FcmConfig | null = null;

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Configure FCM with a service account JSON
 */
export function configureFcm(serviceAccountJson: string): void {
  try {
    const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;

    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
      throw new Error('Invalid service account: missing required fields');
    }

    fcmConfig = { serviceAccount };
  } catch (error) {
    throw new Error(`Failed to parse FCM service account: ${error}`);
  }
}

/**
 * Check if FCM is configured
 */
export function isFcmConfigured(): boolean {
  return fcmConfig !== null;
}

/**
 * Generate a JWT for Google OAuth2
 */
async function generateJwt(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: TOKEN_URL,
    iat: now,
    exp: expiry,
    scope: FCM_SCOPE,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key
  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign the token
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Get an access token for FCM, refreshing if needed
 */
async function getAccessToken(): Promise<string> {
  if (!fcmConfig) {
    throw new Error('FCM not configured');
  }

  // Return cached token if still valid (with 5 minute buffer)
  if (
    fcmConfig.accessToken &&
    fcmConfig.tokenExpiry &&
    Date.now() < fcmConfig.tokenExpiry - 300000
  ) {
    return fcmConfig.accessToken;
  }

  const jwt = await generateJwt(fcmConfig.serviceAccount);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  fcmConfig.accessToken = data.access_token;
  fcmConfig.tokenExpiry = Date.now() + data.expires_in * 1000;

  return data.access_token;
}

/**
 * Send a push notification to a single device
 */
export async function sendFcmNotification(
  deviceToken: DeviceToken,
  payload: FcmPayload,
  db: D1Database
): Promise<{ success: boolean; removed?: boolean }> {
  if (!fcmConfig) {
    throw new Error('FCM not configured');
  }

  try {
    const accessToken = await getAccessToken();
    const projectId = fcmConfig.serviceAccount.project_id;
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    // Build the message based on platform
    const message: Record<string, unknown> = {
      token: deviceToken.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
    };

    // Add data payload if present
    if (payload.data) {
      message.data = payload.data;
    }

    // Platform-specific config
    if (deviceToken.platform === 'android') {
      message.android = {
        priority: 'high',
        notification: {
          channel_id: 'photos',
        },
      };
    } else if (deviceToken.platform === 'ios') {
      message.apns = {
        payload: {
          aps: {
            badge: 1,
            sound: 'default',
          },
        },
      };
    }

    const response = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (response.ok) {
      return { success: true };
    }

    // Parse error response (handle non-JSON responses gracefully)
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: { code?: number; status?: string; message?: string };
    };
    const errorCode = errorData.error?.code ?? response.status;
    const errorStatus = errorData.error?.status;

    // Handle invalid/unregistered tokens
    if (
      errorCode === 404 ||
      errorStatus === 'NOT_FOUND' ||
      errorStatus === 'UNREGISTERED' ||
      errorData.error?.message?.includes('not a valid FCM registration token')
    ) {
      console.log(`Removing invalid FCM token for user ${deviceToken.user_id}`);
      await deleteDeviceTokenByToken(db, deviceToken.token);
      return { success: false, removed: true };
    }

    console.error('FCM notification failed:', errorData);
    return { success: false };
  } catch (error) {
    console.error('FCM notification error:', error);
    return { success: false };
  }
}

/**
 * Send push notifications to multiple devices
 */
export async function sendFcmNotifications(
  deviceTokens: DeviceToken[],
  payload: FcmPayload,
  db: D1Database
): Promise<{ sent: number; failed: number; removed: number }> {
  let sent = 0;
  let failed = 0;
  let removed = 0;

  const results = await Promise.allSettled(
    deviceTokens.map((token) => sendFcmNotification(token, payload, db))
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
