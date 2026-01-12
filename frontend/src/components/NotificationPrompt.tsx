import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { urlBase64ToUint8Array } from '../lib/push';
import { ConfirmModal } from './ConfirmModal';

type PromptState = 'loading' | 'hidden' | 'show' | 'error';

const STORAGE_KEY = 'notificationPrompt';

interface StoredState {
  dismissedGroups?: string[];
  dismissedPermanently?: boolean;
}

function getStoredState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStoredState(state: StoredState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function NotificationPrompt() {
  const { currentGroup } = useAuth();
  const [state, setState] = useState<PromptState>('loading');
  const [isEnabling, setIsEnabling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkShouldShow = useCallback(async () => {
    // Check if push is supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('hidden');
      return;
    }

    // Check if already granted or denied
    if (Notification.permission !== 'default') {
      setState('hidden');
      return;
    }

    // Check if running as installed PWA or Firefox (which doesn't need install)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

    if (!isStandalone && !isIOSStandalone && !isFirefox) {
      setState('hidden');
      return;
    }

    // Check if dismissed for this group or permanently
    const stored = getStoredState();
    if (stored.dismissedPermanently) {
      setState('hidden');
      return;
    }

    if (currentGroup && stored.dismissedGroups?.includes(currentGroup.id)) {
      setState('hidden');
      return;
    }

    // Check if already subscribed for this group
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription && currentGroup) {
        const { subscribed } = await api.push.getStatus(subscription.endpoint);
        if (subscribed) {
          setState('hidden');
          return;
        }
      }
    } catch {
      // Continue to show prompt on error
    }

    setState('show');
  }, [currentGroup]);

  useEffect(() => {
    checkShouldShow();
  }, [checkShouldShow]);

  const handleEnable = async () => {
    setIsEnabling(true);
    setErrorMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('hidden');
        return;
      }

      const { publicKey } = await api.push.getVapidPublicKey();
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.push.subscribe(subscription.toJSON());
      setState('hidden');
    } catch (error) {
      console.error('Error enabling notifications:', error);
      setErrorMessage('Failed to enable notifications. Please try again.');
      setState('error');
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDismiss = (permanently: boolean) => {
    const stored = getStoredState();

    if (permanently) {
      saveStoredState({ ...stored, dismissedPermanently: true });
    } else if (currentGroup) {
      const dismissedGroups = stored.dismissedGroups || [];
      if (!dismissedGroups.includes(currentGroup.id)) {
        saveStoredState({
          ...stored,
          dismissedGroups: [...dismissedGroups, currentGroup.id],
        });
      }
    }

    setState('hidden');
  };

  const handleErrorDismiss = () => {
    setErrorMessage(null);
    setState('hidden');
  };

  if (state === 'error' && errorMessage) {
    return (
      <ConfirmModal
        title="Notification error"
        message={errorMessage}
        confirmLabel="OK"
        onConfirm={handleErrorDismiss}
        onCancel={handleErrorDismiss}
      />
    );
  }

  if (state !== 'show') {
    return null;
  }

  return (
    <ConfirmModal
      title="Enable notifications"
      message="Get notified when new photos are shared in this group. You can disable this anytime from the bell icon."
      confirmLabel={isEnabling ? 'Enabling...' : 'Enable'}
      cancelLabel="Not now"
      onConfirm={handleEnable}
      onCancel={() => handleDismiss(false)}
      showDontAskAgain
      onDontAskAgain={() => handleDismiss(true)}
    />
  );
}
