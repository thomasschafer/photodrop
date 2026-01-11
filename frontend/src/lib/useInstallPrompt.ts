import { useState, useEffect, useCallback } from 'react';

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

const STORAGE_KEY = 'installPrompt';
const DISMISS_EVENT = 'installPromptDismissed';

interface StoredState {
  dismissed?: boolean;
  dismissedAt?: number;
}

function getStoredState(): StoredState {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStoredState(state: StoredState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  if (isFirefox) return 'firefox';
  if (isIOS) return 'ios';
  if (isMacOS && isSafari) return 'macos-safari';
  if (isAndroid) return 'android';

  return 'desktop';
}

function checkIsInstalled(): boolean {
  if (typeof window === 'undefined') return false;

  // Check if running in standalone mode (installed PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isStandalone || isIOSStandalone;
}

export function useInstallPrompt() {
  const [state, setState] = useState<InstallState>(() => ({
    platform: detectPlatform(),
    isInstalled: checkIsInstalled(),
    canPromptNatively: false,
    isDismissed: getStoredState().dismissed ?? false,
    deferredPrompt: null,
  }));

  // Listen for beforeinstallprompt event (Android/Desktop Chrome/Edge)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setState((prev) => ({
        ...prev,
        canPromptNatively: true,
        deferredPrompt: e as BeforeInstallPromptEvent,
      }));
    };

    const handleAppInstalled = () => {
      setState((prev) => ({
        ...prev,
        isInstalled: true,
        canPromptNatively: false,
        deferredPrompt: null,
      }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
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

  const triggerNativePrompt = useCallback(async (): Promise<boolean> => {
    if (!state.deferredPrompt) return false;

    try {
      await state.deferredPrompt.prompt();
      const { outcome } = await state.deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setState((prev) => ({
          ...prev,
          isInstalled: true,
          canPromptNatively: false,
          deferredPrompt: null,
        }));
        return true;
      }
    } catch (error) {
      console.error('Error triggering install prompt:', error);
    }

    return false;
  }, [state.deferredPrompt]);

  const dismiss = useCallback((permanently = false) => {
    if (permanently) {
      saveStoredState({ dismissed: true, dismissedAt: Date.now() });
    }
    setState((prev) => ({ ...prev, isDismissed: true }));
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, []);

  const resetDismissal = useCallback(() => {
    saveStoredState({});
    setState((prev) => ({ ...prev, isDismissed: false }));
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
