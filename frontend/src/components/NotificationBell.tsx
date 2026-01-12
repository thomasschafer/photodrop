import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { urlBase64ToUint8Array } from '../lib/push';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';

type NotificationState = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export function NotificationBell() {
  const { currentGroup } = useAuth();
  const [state, setState] = useState<NotificationState>('loading');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);
  const [showUnsupportedHelp, setShowUnsupportedHelp] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const checkSubscriptionStatus = useCallback(async () => {
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

  useEffect(() => {
    setState('loading');
    checkSubscriptionStatus();
  }, [checkSubscriptionStatus, currentGroup?.id]);

  const subscribe = async () => {
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

  const unsubscribe = async () => {
    setIsProcessing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await api.push.unsubscribe(subscription.endpoint);
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
          message="You previously blocked notifications for this site. To enable them, you'll need to change your browser settings. Look for the lock or info icon in your browser's address bar, find 'Notifications', and change it from 'Block' to 'Allow'. Then refresh the page."
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
