import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { urlBase64ToUint8Array } from '../lib/push';
import {
  isNativePlatform,
  checkPermissions as checkNativePermissions,
  requestPermissions as requestNativePermissions,
  registerForPush,
  registerDeviceWithBackend,
  unregisterDeviceFromBackend,
  isRegisteredWithBackend,
  getCurrentToken,
} from '../lib/nativePush';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';

type NotificationState = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export function NotificationBell() {
  const { currentGroup } = useAuth();
  const isNative = isNativePlatform();
  const [state, setState] = useState<NotificationState>('loading');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);
  const [showUnsupportedHelp, setShowUnsupportedHelp] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check web push subscription status
  const checkWebSubscriptionStatus = useCallback(async () => {
    if (!navigator.serviceWorker || !window.PushManager) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setState('unsubscribed');
        return;
      }

      const { subscribed } = await api.push.getStatus(subscription.endpoint);
      setState(subscribed ? 'subscribed' : 'unsubscribed');
    } catch (error) {
      console.error('Error checking subscription status:', error);
      setState('unsubscribed');
    }
  }, []);

  // Check native push subscription status
  const checkNativeSubscriptionStatus = useCallback(async () => {
    console.log('[NotificationBell] Checking native subscription status...');
    try {
      const permission = await checkNativePermissions();
      console.log('[NotificationBell] Native permission:', permission);

      if (permission === 'denied') {
        setState('denied');
        return;
      }

      // If we don't have a token yet, user hasn't subscribed
      const token = getCurrentToken();
      console.log('[NotificationBell] Current token:', token ? 'exists' : 'null');
      if (!token) {
        setState('unsubscribed');
        return;
      }

      // Check if registered with backend for this group
      const registered = await isRegisteredWithBackend();
      console.log('[NotificationBell] Registered with backend:', registered);
      setState(registered ? 'subscribed' : 'unsubscribed');
    } catch (error) {
      console.error('[NotificationBell] Error checking native subscription status:', error);
      setState('unsubscribed');
    }
  }, []);

  useEffect(() => {
    console.log('[NotificationBell] useEffect triggered, isNative:', isNative);
    setState('loading');
    if (isNative) {
      checkNativeSubscriptionStatus();
    } else {
      checkWebSubscriptionStatus();
    }
  }, [checkWebSubscriptionStatus, checkNativeSubscriptionStatus, currentGroup?.id, isNative]);

  // Subscribe to web push
  const subscribeWeb = async () => {
    setIsProcessing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }

      const { publicKey } = await api.push.getVapidPublicKey();
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subscriptionJson = subscription.toJSON();
      await api.push.subscribe(subscriptionJson);

      setState('subscribed');
    } catch (error) {
      console.error('Error subscribing to notifications:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Subscribe to native push
  const subscribeNative = async () => {
    setIsProcessing(true);
    try {
      const permission = await requestNativePermissions();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }

      const token = await registerForPush();
      if (!token) {
        console.error('Failed to get push token');
        return;
      }

      await registerDeviceWithBackend();
      setState('subscribed');
    } catch (error) {
      console.error('Error subscribing to native notifications:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Unsubscribe from web push
  const unsubscribeWeb = async () => {
    setIsProcessing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await api.push.unsubscribeFromCurrentGroup(subscription.endpoint);
        await subscription.unsubscribe();
      }

      setState('unsubscribed');
    } catch (error) {
      console.error('Error unsubscribing from notifications:', error);
    } finally {
      setIsProcessing(false);
      setShowConfirm(false);
    }
  };

  // Unsubscribe from native push
  const unsubscribeNative = async () => {
    setIsProcessing(true);
    try {
      await unregisterDeviceFromBackend();
      setState('unsubscribed');
    } catch (error) {
      console.error('Error unsubscribing from native notifications:', error);
    } finally {
      setIsProcessing(false);
      setShowConfirm(false);
    }
  };

  const subscribe = isNative ? subscribeNative : subscribeWeb;
  const unsubscribe = isNative ? unsubscribeNative : unsubscribeWeb;

  const handleClick = () => {
    if (state === 'subscribed') {
      setShowConfirm(true);
    } else if (state === 'unsubscribed') {
      subscribe();
    } else if (state === 'denied') {
      setShowBlockedHelp(true);
    } else if (state === 'unsupported') {
      setShowUnsupportedHelp(true);
    }
  };

  if (state === 'loading') {
    return null;
  }

  const isSubscribed = state === 'subscribed';
  const isDenied = state === 'denied';
  const isUnsupported = state === 'unsupported';
  const isDisabled = isDenied || isUnsupported;

  return (
    <>
      <button
        onClick={handleClick}
        disabled={isProcessing}
        aria-label={
          isUnsupported
            ? 'Notifications not supported - click for help'
            : isDenied
              ? 'Notifications blocked - click for help'
              : isSubscribed
                ? 'Disable notifications'
                : 'Enable notifications'
        }
        title={
          isUnsupported
            ? 'Notifications are not supported. Click for help.'
            : isDenied
              ? 'Notifications are blocked. Click for help enabling them.'
              : isSubscribed
                ? 'Notifications enabled for this group'
                : 'Enable notifications for this group'
        }
        className={`flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer transition-colors ${
          isDisabled
            ? 'border-border bg-surface text-text-tertiary hover:border-border-strong hover:text-text-secondary'
            : isSubscribed
              ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
              : 'border-border bg-surface text-text-secondary hover:border-border-strong'
        }`}
      >
        {isProcessing ? (
          <div className="spinner spinner-sm" />
        ) : isSubscribed ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            {isDisabled && <path d="M1 1l22 22" strokeWidth="2" />}
          </svg>
        )}
      </button>

      {showConfirm && (
        <ConfirmModal
          title="Disable notifications?"
          message="You will no longer receive notifications when new photos are added to this group."
          confirmLabel="Disable"
          onConfirm={unsubscribe}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {showBlockedHelp && (
        <ConfirmModal
          title="Notifications blocked"
          message={
            isNative
              ? 'You previously denied notification permissions. To enable them, go to your device Settings, find this app, and enable Notifications.'
              : "You previously blocked notifications for this site. To enable them, you'll need to change your browser settings. Look for the lock or info icon in your browser's address bar, find 'Notifications', and change it from 'Block' to 'Allow'. Then refresh the page."
          }
          confirmLabel="Got it"
          onConfirm={() => setShowBlockedHelp(false)}
          onCancel={() => setShowBlockedHelp(false)}
        />
      )}

      {showUnsupportedHelp && (
        <ConfirmModal
          title="Notifications not supported"
          message="Your browser doesn't support push notifications. To receive notifications when new photos are shared, try using Chrome, Firefox, or Edge on desktop, or install this app on your phone by tapping 'Add to Home Screen' in your browser menu."
          confirmLabel="Got it"
          onConfirm={() => setShowUnsupportedHelp(false)}
          onCancel={() => setShowUnsupportedHelp(false)}
        />
      )}
    </>
  );
}
