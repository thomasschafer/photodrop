/**
 * Native push notification handling for iOS and Android via Capacitor
 * Uses Firebase Cloud Messaging (FCM) for both platforms
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

// Store the current FCM token
let currentToken: string | null = null;

// Track if listeners have been set up
let listenersInitialized = false;

// Pending registration promise resolver
let pendingRegistration: {
  resolve: (token: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * Check if we're running on a native platform
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get the current platform ('ios' | 'android' | null for web)
 */
export function getPlatform(): 'ios' | 'android' | null {
  if (!isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

/**
 * Get the current FCM token (if registered)
 */
export function getCurrentToken(): string | null {
  return currentToken;
}

/**
 * Check if push notifications are supported
 */
export async function checkPermissions(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) return 'denied';

  const result = await PushNotifications.checkPermissions();
  // Capacitor returns PermissionState which includes 'prompt-with-rationale' on some platforms
  // Normalize to our simpler type
  if (result.receive === 'granted') return 'granted';
  if (result.receive === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Request push notification permissions
 */
export async function requestPermissions(): Promise<'granted' | 'denied'> {
  if (!isNativePlatform()) return 'denied';

  const result = await PushNotifications.requestPermissions();
  return result.receive === 'granted' ? 'granted' : 'denied';
}

/**
 * Set up push notification listeners (called once)
 */
async function setupListeners(): Promise<void> {
  if (listenersInitialized) return;
  listenersInitialized = true;

  // Handle registration success
  await PushNotifications.addListener('registration', (result) => {
    currentToken = result.value;
    if (pendingRegistration) {
      clearTimeout(pendingRegistration.timeout);
      pendingRegistration.resolve(result.value);
      pendingRegistration = null;
    }
  });

  // Handle registration error
  await PushNotifications.addListener('registrationError', (error) => {
    console.error('Push registration error:', error);
    if (pendingRegistration) {
      clearTimeout(pendingRegistration.timeout);
      pendingRegistration.resolve(null);
      pendingRegistration = null;
    }
  });

  // Handle incoming notifications when app is in foreground
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Push notification received:', notification);
    // Notifications are shown automatically by the OS when app is backgrounded
    // When in foreground, we could show an in-app notification if desired
  });

  // Handle notification tap (when user taps a notification)
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('Push notification action:', action);
    const data = action.notification.data;

    // Navigate to the relevant content
    if (data?.url) {
      // Extract path from URL and navigate (preserve query and hash)
      try {
        const url = new URL(data.url);
        window.location.href = url.pathname + url.search + url.hash;
      } catch {
        // If it's already a path, use directly
        window.location.href = data.url;
      }
    } else if (data?.groupId) {
      // Navigate to group
      window.location.href = `/`;
    }
  });
}

/**
 * Register for push notifications and get FCM token
 * Returns the token on success, null on failure
 */
export async function registerForPush(): Promise<string | null> {
  console.log('[NativePush] registerForPush called, isNative:', isNativePlatform());
  if (!isNativePlatform()) return null;

  // If we already have a token, return it
  if (currentToken) {
    console.log('[NativePush] Already have token:', currentToken.substring(0, 20) + '...');
    return currentToken;
  }

  try {
    // Check/request permissions
    let permission = await checkPermissions();
    console.log('[NativePush] Current permission:', permission);
    if (permission === 'prompt') {
      console.log('[NativePush] Requesting permission...');
      permission = await requestPermissions();
      console.log('[NativePush] Permission result:', permission);
    }

    if (permission !== 'granted') {
      console.log('[NativePush] Push notification permission denied');
      return null;
    }

    // Set up listeners before registering
    await setupListeners();

    // Register with FCM and wait for result
    const token = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('Push registration timed out');
        pendingRegistration = null;
        resolve(null);
      }, 10000);

      pendingRegistration = { resolve, timeout };

      PushNotifications.register();
    });

    return token;
  } catch (error) {
    console.error('Error registering for push:', error);
    return null;
  }
}

/**
 * Register the device token with the backend for the current group
 */
export async function registerDeviceWithBackend(): Promise<boolean> {
  const platform = getPlatform();
  if (!platform || !currentToken) return false;

  try {
    await api.push.registerDevice(platform, currentToken);
    return true;
  } catch (error) {
    console.error('Error registering device with backend:', error);
    return false;
  }
}

/**
 * Unregister the device token from the backend for the current group
 */
export async function unregisterDeviceFromBackend(): Promise<boolean> {
  if (!currentToken) return false;

  try {
    await api.push.unregisterDevice(currentToken);
    return true;
  } catch (error) {
    console.error('Error unregistering device from backend:', error);
    return false;
  }
}

/**
 * Check if the current token is registered with the backend
 */
export async function isRegisteredWithBackend(): Promise<boolean> {
  if (!currentToken) return false;

  try {
    const { registered } = await api.push.getDeviceStatus(currentToken);
    return registered;
  } catch {
    return false;
  }
}

/**
 * Initialize native push notifications
 * Call this on app startup after authentication
 */
export async function initializeNativePush(): Promise<void> {
  console.log('[NativePush] initializeNativePush called');
  if (!isNativePlatform()) {
    console.log('[NativePush] Not native platform, skipping');
    return;
  }

  const token = await registerForPush();
  console.log('[NativePush] Got token:', token ? token.substring(0, 20) + '...' : 'null');
  if (token) {
    const registered = await registerDeviceWithBackend();
    console.log('[NativePush] Backend registration:', registered ? 'success' : 'failed');
  }
}

/**
 * Clean up on logout - unregister from backend but keep FCM registration
 */
export async function cleanupOnLogout(): Promise<void> {
  if (currentToken) {
    await unregisterDeviceFromBackend();
  }
}

/**
 * Re-register with backend when switching groups
 */
export async function onGroupSwitch(): Promise<void> {
  if (currentToken) {
    await registerDeviceWithBackend();
  }
}
