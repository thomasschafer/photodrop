import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  INSTALL_PROMPT_STORAGE_KEY,
  INSTALL_PROMPT_DISMISSED,
  type InstallPromptState,
} from '@photodrop/common/storage';
import { setLocalStorageItem } from './storage';

type Platform = 'ios' | 'android' | 'macos-safari' | 'desktop' | 'firefox' | 'unknown';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  platform: Platform;
  isInstalled: boolean;
  canPromptNatively: boolean;
  isDismissed: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
}

const DISMISS_EVENT = 'installPromptDismissed';
const PROMPT_EVENT = 'installPromptAvailable';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;

export type NativeInstallResult = 'accepted' | 'dismissed' | 'unavailable' | 'error';

function getStoredState(): InstallPromptState {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStoredState(state: InstallPromptState): void {
  if (typeof window === 'undefined') return;
  setLocalStorageItem(INSTALL_PROMPT_STORAGE_KEY, JSON.stringify(state));
}

function isStoredDismissed(state: InstallPromptState): boolean {
  if (state.dismissed) return true;
  return typeof state.dismissedAt === 'number' && Date.now() - state.dismissedAt < SNOOZE_MS;
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown';

  const ua = navigator.userAgent.toLowerCase();
  const isFirefox = ua.includes('firefox');
  const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  const isIOS =
    /ipad|iphone|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMacOS = navigator.platform.toLowerCase().includes('mac') && !isIOS;
  const isAndroid = ua.includes('android');

  if (isIOS) return 'ios';
  if (isMacOS && isSafari) return 'macos-safari';
  if (isAndroid) return 'android';
  if (isFirefox) return 'firefox';

  return 'desktop';
}

function checkIsInstalled(): boolean {
  if (typeof window === 'undefined') return false;

  // Native Capacitor app is always "installed"
  if (Capacitor.isNativePlatform()) return true;

  // Check if running in standalone mode (installed PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isStandalone || isIOSStandalone;
}

export function useInstallPrompt() {
  const [state, setState] = useState<InstallState>(() => ({
    platform: detectPlatform(),
    isInstalled: checkIsInstalled(),
    canPromptNatively: sharedDeferredPrompt !== null,
    isDismissed: isStoredDismissed(getStoredState()),
    deferredPrompt: sharedDeferredPrompt,
  }));

  // Listen for beforeinstallprompt event (Android/Desktop Chrome/Edge)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      sharedDeferredPrompt = e as BeforeInstallPromptEvent;
      setState((prev) => ({
        ...prev,
        canPromptNatively: true,
        deferredPrompt: e as BeforeInstallPromptEvent,
      }));
      window.dispatchEvent(new Event(PROMPT_EVENT));
    };

    const handleAppInstalled = () => {
      sharedDeferredPrompt = null;
      setState((prev) => ({
        ...prev,
        isInstalled: true,
        canPromptNatively: false,
        deferredPrompt: null,
      }));
    };

    const handlePromptAvailable = () => {
      setState((prev) => ({
        ...prev,
        canPromptNatively: sharedDeferredPrompt !== null,
        deferredPrompt: sharedDeferredPrompt,
      }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener(PROMPT_EVENT, handlePromptAvailable);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener(PROMPT_EVENT, handlePromptAvailable);
    };
  }, []);

  // Re-check installed state on visibility change (user may have installed while away)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const isInstalled = checkIsInstalled();
        if (isInstalled) {
          setState((prev) => ({ ...prev, isInstalled }));
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Listen for dismiss events from other hook instances
  useEffect(() => {
    const handleDismissEvent = () => {
      setState((prev) => ({ ...prev, isDismissed: true }));
    };

    window.addEventListener(DISMISS_EVENT, handleDismissEvent);
    return () => window.removeEventListener(DISMISS_EVENT, handleDismissEvent);
  }, []);

  const triggerNativePrompt = useCallback(async (): Promise<NativeInstallResult> => {
    const prompt = state.deferredPrompt ?? sharedDeferredPrompt;
    if (!prompt) return 'unavailable';

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      sharedDeferredPrompt = null;

      if (outcome === 'accepted') {
        setState((prev) => ({
          ...prev,
          isInstalled: true,
          canPromptNatively: false,
          deferredPrompt: null,
        }));
        window.dispatchEvent(new Event(PROMPT_EVENT));
        return 'accepted';
      }
      saveStoredState({ dismissedAt: Date.now() });
      setState((prev) => ({
        ...prev,
        isDismissed: true,
        canPromptNatively: false,
        deferredPrompt: null,
      }));
      window.dispatchEvent(new Event(DISMISS_EVENT));
      window.dispatchEvent(new Event(PROMPT_EVENT));
      return 'dismissed';
    } catch (error) {
      console.error('Error triggering install prompt:', error);
      sharedDeferredPrompt = null;
      setState((prev) => ({ ...prev, canPromptNatively: false, deferredPrompt: null }));
      window.dispatchEvent(new Event(PROMPT_EVENT));
      return 'error';
    }
  }, [state.deferredPrompt]);

  const dismiss = useCallback((permanently = false) => {
    if (permanently) {
      saveStoredState({ ...INSTALL_PROMPT_DISMISSED, dismissedAt: Date.now() });
    } else {
      saveStoredState({ dismissedAt: Date.now() });
    }
    setState((prev) => ({ ...prev, isDismissed: true }));
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, []);

  const resetDismissal = useCallback(() => {
    saveStoredState({});
    setState((prev) => ({
      ...prev,
      isDismissed: false,
      canPromptNatively: sharedDeferredPrompt !== null,
      deferredPrompt: sharedDeferredPrompt,
    }));
  }, []);

  // Determine if we should show the install prompt
  const shouldShowPrompt = !state.isInstalled && !state.isDismissed;

  // For Firefox, skip install - notifications work in browser
  const canSkipInstall = state.platform === 'firefox';

  return {
    platform: state.platform,
    isInstalled: state.isInstalled,
    canPromptNatively: state.canPromptNatively,
    isDismissed: state.isDismissed,
    shouldShowPrompt,
    canSkipInstall,
    triggerNativePrompt,
    dismiss,
    resetDismissal,
  };
}
