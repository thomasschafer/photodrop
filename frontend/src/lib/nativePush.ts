/**
 * Native push notification handling for iOS and Android via Capacitor
 * Uses Firebase Cloud Messaging (FCM) for both platforms
 */

import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

// Store the current FCM token
let currentToken: string | null = null;

// Track if listeners have been set up
let listenersInitialized = false;

// Track initialization to prevent race with logout
let initializationAborted = false;

// Pending registration state (shared across concurrent calls)
let pendingRegistrationPromise: Promise<string | null> | null = null;
let pendingResolve: ((token: string | null) => void) | null = null;

// Shared initialization promise so UI components can await initialization
let initializationPromise: Promise<void> | null = null;
let initializationComplete = false;

// Debug timeline for diagnosing cold-start issues
const debugTimeline: Array<{ ts: number; event: string }> = [];

// Track whether the app has been fully visible at least once
let appFullyVisible = false;

function logDebug(event: string) {
  const ts = Date.now();
  debugTimeline.push({ ts, event });
  console.log(`[NativePush ${ts}] ${event}`);
}

/**
 * Wait for the app to be fully visible (splash screen dismissed, activity resumed).
 * On cold start, the splash screen may overlay permission dialogs, so we need to
 * ensure the app is in the foreground before requesting permissions.
 */
async function waitForAppReady(): Promise<void> {
  if (appFullyVisible) return;

  logDebug('waiting for app to be fully visible...');

  // Check current state first
  try {
    const state = await CapApp.getState();
    if (state.isActive) {
      // App reports active, but on cold start the splash screen may still be showing.
      // Wait a short period for the splash screen to dismiss and the WebView to be fully interactive.
      logDebug(`app state: active, waiting for splash screen to dismiss`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      appFullyVisible = true;
      logDebug('app ready (active + delay)');
      return;
    }
  } catch {
    // getState failed, fall through to listener approach
  }

  // App not active yet — wait for it to become active
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      logDebug('app ready timeout (5s), proceeding anyway');
      appFullyVisible = true;
      resolve();
    }, 5000);

    CapApp.addListener('appStateChange', (state) => {
      if (state.isActive) {
        clearTimeout(timeout);
        // Additional delay for splash screen dismissal
        setTimeout(() => {
          appFullyVisible = true;
          logDebug('app ready (state change + delay)');
          resolve();
        }, 500);
      }
    });
  });
}

/**
 * After the permission dialog closes, Android may need a beat to fully resume
 * the activity before FCM registration is safe.
 */
async function waitForPostPermissionResume(): Promise<void> {
  try {
    const state = await CapApp.getState();
    if (state.isActive) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return;
    }
  } catch {
    // getState failed, fall through to listener approach
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 2000);
    CapApp.addListener('appStateChange', (state) => {
      if (state.isActive) {
        clearTimeout(timeout);
        setTimeout(() => resolve(), 400);
      }
    });
  });
}

/**
 * Get the debug timeline for diagnostics
 */
export function getDebugTimeline(): Array<{ ts: number; event: string }> {
  return [...debugTimeline];
}

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
    logDebug(`registration event received, token: ${result.value?.substring(0, 20)}...`);
    currentToken = result.value;
    if (pendingResolve) {
      pendingResolve(result.value);
      pendingResolve = null;
    }
  });

  // Handle registration error
  await PushNotifications.addListener('registrationError', (error) => {
    logDebug(`registrationError event: ${JSON.stringify(error)}`);
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
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
  logDebug('registerForPush called');
  if (!isNativePlatform()) return null;

  // If we already have a token, return it
  if (currentToken) {
    logDebug('already have token');
    return currentToken;
  }

  try {
    // Check/request permissions
    let permission = await checkPermissions();
    logDebug(`checkPermissions: ${permission}`);
    if (permission === 'prompt') {
      logDebug('requesting permission...');
      permission = await requestPermissions();
      logDebug(`requestPermissions result: ${permission}`);
    }

    if (permission !== 'granted') {
      logDebug('permission denied');
      return null;
    }

    // Allow the activity to fully resume after the permission dialog closes
    logDebug('waiting for post-permission resume...');
    await waitForPostPermissionResume();

    // Set up listeners before registering
    await setupListeners();
    logDebug('listeners set up');

    // If registration is already in progress, return the existing promise
    if (pendingRegistrationPromise) {
      logDebug('registration already in progress, waiting...');
      return pendingRegistrationPromise;
    }

    // Register with FCM and wait for result
    logDebug('calling PushNotifications.register()');
    pendingRegistrationPromise = new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        logDebug('FCM registration timed out (10s)');
        pendingResolve = null;
        pendingRegistrationPromise = null;
        resolve(null);
      }, 10000);

      // Store resolve function for the listener to call
      pendingResolve = (token) => {
        clearTimeout(timeout);
        pendingRegistrationPromise = null;
        resolve(token);
      };

      PushNotifications.register();
    });

    return pendingRegistrationPromise;
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
 * Check if native push initialization has completed
 */
export function isNativePushInitialized(): boolean {
  return initializationComplete;
}

/**
 * Wait for native push initialization to complete.
 * Returns immediately if not native or already initialized.
 * UI components should call this instead of independently checking status.
 */
export function waitForNativePushInit(): Promise<void> {
  if (!isNativePlatform() || initializationComplete) return Promise.resolve();
  if (initializationPromise) return initializationPromise;
  // Init hasn't started yet — return a promise that resolves when it does
  return new Promise<void>((resolve) => {
    const handler = () => {
      window.removeEventListener('nativePushStateChanged', handler);
      resolve();
    };
    window.addEventListener('nativePushStateChanged', handler);
    // Safety timeout — don't wait forever
    setTimeout(() => {
      window.removeEventListener('nativePushStateChanged', handler);
      resolve();
    }, 15000);
  });
}

/**
 * Crash guard: detect if push init is causing repeated crashes.
 * We set a flag before attempting FCM registration and clear it after.
 * If the flag is still set on next app start, push init likely crashed the app.
 */
const PUSH_INIT_GUARD_KEY = 'nativePush_initInProgress';
const PUSH_INIT_CRASH_COUNT_KEY = 'nativePush_crashCount';
const MAX_CRASH_RETRIES = 2;

function markPushInitStarted(): void {
  try {
    const crashCount = parseInt(localStorage.getItem(PUSH_INIT_CRASH_COUNT_KEY) || '0', 10);
    localStorage.setItem(PUSH_INIT_GUARD_KEY, 'true');
    localStorage.setItem(PUSH_INIT_CRASH_COUNT_KEY, String(crashCount + 1));
  } catch {
    // localStorage not available
  }
}

function markPushInitCompleted(): void {
  try {
    localStorage.removeItem(PUSH_INIT_GUARD_KEY);
    localStorage.setItem(PUSH_INIT_CRASH_COUNT_KEY, '0');
  } catch {
    // localStorage not available
  }
}

function isPushInitCrashing(): boolean {
  try {
    const wasInProgress = localStorage.getItem(PUSH_INIT_GUARD_KEY) === 'true';
    const crashCount = parseInt(localStorage.getItem(PUSH_INIT_CRASH_COUNT_KEY) || '0', 10);
    return wasInProgress && crashCount >= MAX_CRASH_RETRIES;
  } catch {
    return false;
  }
}

/**
 * Reset the crash guard (called from debug UI to retry)
 */
export function resetPushCrashGuard(): void {
  try {
    localStorage.removeItem(PUSH_INIT_GUARD_KEY);
    localStorage.setItem(PUSH_INIT_CRASH_COUNT_KEY, '0');
  } catch {
    // localStorage not available
  }
}

/**
 * Initialize native push notifications
 * Call this on app startup after authentication
 */
export async function initializeNativePush(): Promise<void> {
  logDebug('initializeNativePush called');
  if (!isNativePlatform()) {
    logDebug('not native platform, skipping');
    return;
  }

  // Check crash guard — if push init has been crashing the app, skip auto-init
  if (isPushInitCrashing()) {
    logDebug(
      'CRASH GUARD: push init has crashed the app repeatedly, skipping auto-init. Tap bell to retry.'
    );
    initializationComplete = true;
    window.dispatchEvent(new CustomEvent('nativePushStateChanged'));
    return;
  }

  // Return existing promise if already in progress
  if (initializationPromise) {
    logDebug('init already in progress, returning existing promise');
    return initializationPromise;
  }

  initializationAborted = false;

  initializationPromise = (async () => {
    try {
      // Wait for the app to be fully visible before requesting permissions.
      // On cold start, the splash screen may overlay the Android permission dialog,
      // causing it to be invisible or dismissed without user interaction.
      await waitForAppReady();

      // Set crash guard before FCM registration (the risky part)
      markPushInitStarted();

      const token = await registerForPush();
      logDebug(`registerForPush returned: ${token ? 'token' : 'null'}`);

      // Clear crash guard — we survived FCM registration
      markPushInitCompleted();

      if (initializationAborted) {
        logDebug('Initialization aborted by logout, skipping backend registration');
        return;
      }
      if (token) {
        const registered = await registerDeviceWithBackend();
        logDebug(`backend registration: ${registered ? 'success' : 'failed'}`);
      }
    } catch (error) {
      logDebug(`init error: ${error instanceof Error ? error.message : String(error)}`);
      markPushInitCompleted(); // Clear guard on caught errors (app didn't crash)
    } finally {
      initializationComplete = true;
      logDebug('init complete, dispatching nativePushStateChanged');
      window.dispatchEvent(new CustomEvent('nativePushStateChanged'));
    }
  })();

  return initializationPromise;
}

/**
 * Clean up on logout - unregister from backend but keep FCM registration
 */
export async function cleanupOnLogout(): Promise<void> {
  // Abort any in-flight initialization to prevent it from re-registering after cleanup
  initializationAborted = true;

  if (currentToken) {
    await unregisterDeviceFromBackend();
  }
  // Reset initialization state so next login re-initializes
  initializationPromise = null;
  initializationComplete = false;
}

/**
 * Re-register with backend when switching groups
 */
export async function onGroupSwitch(): Promise<void> {
  if (currentToken) {
    await registerDeviceWithBackend();
  }
}
