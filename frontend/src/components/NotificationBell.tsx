import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Modal } from './Modal';
import { useAuth } from '../contexts/AuthContext';

type NotificationState =
  | 'loading'
  | 'unsupported'
  | 'denied'
  | 'subscribed'
  | 'unsubscribed'
  | 'error';

interface DebugInfo {
  isNative: boolean;
  state: NotificationState;
  permission: string | null;
  hasToken: boolean;
  tokenPreview: string | null;
  error: string | null;
  groupId: string | null;
}

export function NotificationBell() {
  const { currentGroup } = useAuth();
  const isNative = isNativePlatform();
  const [state, setState] = useState<NotificationState>('loading');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);
  const [showUnsupportedHelp, setShowUnsupportedHelp] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    isNative: false,
    state: 'loading',
    permission: null,
    hasToken: false,
    tokenPreview: null,
    error: null,
    groupId: null,
  });

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
    const debug: Partial<DebugInfo> = {
      isNative: true,
      groupId: currentGroup?.id || null,
    };

    try {
      const permission = await checkNativePermissions();
      console.log('[NotificationBell] Native permission:', permission);
      debug.permission = permission;

      if (permission === 'denied') {
        debug.state = 'denied';
        setDebugInfo((prev) => ({ ...prev, ...debug, state: 'denied' }));
        setState('denied');
        return;
      }

      // If we don't have a token yet, user hasn't subscribed
      const token = getCurrentToken();
      console.log('[NotificationBell] Current token:', token ? 'exists' : 'null');
      debug.hasToken = !!token;
      debug.tokenPreview = token ? token.substring(0, 20) + '...' : null;

      if (!token) {
        debug.state = 'unsubscribed';
        setDebugInfo((prev) => ({ ...prev, ...debug, state: 'unsubscribed' }));
        setState('unsubscribed');
        return;
      }

      // Check if registered with backend for this group
      const registered = await isRegisteredWithBackend();
      console.log('[NotificationBell] Registered with backend:', registered);
      const finalState = registered ? 'subscribed' : 'unsubscribed';
      debug.state = finalState;
      setDebugInfo((prev) => ({ ...prev, ...debug, state: finalState }));
      setState(finalState);
    } catch (error) {
      console.error('[NotificationBell] Error checking native subscription status:', error);
      debug.error = error instanceof Error ? error.message : String(error);
      debug.state = 'error';
      setDebugInfo((prev) => ({ ...prev, ...debug, state: 'error', error: debug.error || null }));
      setState('error');
    }
  }, [currentGroup?.id]);

  useEffect(() => {
    console.log('[NotificationBell] useEffect triggered, isNative:', isNative);
    setState('loading');
    setDebugInfo((prev) => ({ ...prev, isNative, groupId: currentGroup?.id || null }));
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
    if (state === 'loading' || state === 'error') {
      // Show debug info for loading/error states
      setShowDebug(true);
    } else if (state === 'subscribed') {
      setShowConfirm(true);
    } else if (state === 'unsubscribed') {
      subscribe();
    } else if (state === 'denied') {
      setShowBlockedHelp(true);
    } else if (state === 'unsupported') {
      setShowUnsupportedHelp(true);
    }
  };

  // Long-press handlers for test modal
  const handlePressStart = () => {
    longPressTimer.current = setTimeout(() => {
      setShowTestModal(true);
      setTestResult(null);
    }, 800); // 800ms long-press
  };

  const handlePressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const sendTestNotification = async () => {
    const token = getCurrentToken();
    if (!token) {
      setTestResult('ERROR:No device token - try subscribing first');
      return;
    }

    setIsSendingTest(true);
    setTestResult('Sending...');

    try {
      const result = await api.push.sendTestNotification(token);
      if (result.success) {
        setTestResult(`SUCCESS:${result.message}\n\nDebug: ${JSON.stringify(result.debug, null, 2)}`);
      } else {
        setTestResult(`ERROR:${result.error}\n\nDebug: ${JSON.stringify(result.debug, null, 2)}`);
      }
    } catch (error) {
      setTestResult(`ERROR:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isSubscribed = state === 'subscribed';
  const isDenied = state === 'denied';
  const isUnsupported = state === 'unsupported';
  const isDisabled = isDenied || isUnsupported;
  const showSpinner = isLoading || isProcessing;

  return (
    <>
      <button
        onClick={handleClick}
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        disabled={isProcessing}
        aria-label={
          isLoading
            ? 'Loading notification status...'
            : isError
              ? 'Error checking notifications - tap for details'
              : isUnsupported
                ? 'Notifications not supported - click for help'
                : isDenied
                  ? 'Notifications blocked - click for help'
                  : isSubscribed
                    ? 'Disable notifications'
                    : 'Enable notifications'
        }
        title={
          isLoading
            ? 'Checking notification status...'
            : isError
              ? 'Error - tap for debug info'
              : isUnsupported
                ? 'Notifications are not supported. Click for help.'
                : isDenied
                  ? 'Notifications are blocked. Click for help enabling them.'
                  : isSubscribed
                    ? 'Notifications enabled for this group'
                    : 'Enable notifications for this group'
        }
        className={`flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer transition-colors ${
          isError
            ? 'border-red-500 bg-red-500/10 text-red-500'
            : isLoading
              ? 'border-border bg-surface text-text-tertiary'
              : isDisabled
                ? 'border-border bg-surface text-text-tertiary hover:border-border-strong hover:text-text-secondary'
                : isSubscribed
                  ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
                  : 'border-border bg-surface text-text-secondary hover:border-border-strong'
        }`}
      >
        {showSpinner ? (
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

      {showDebug && (
        <ConfirmModal
          title="Notification debug info"
          message={`
State: ${debugInfo.state}
Platform: ${debugInfo.isNative ? 'Native (Capacitor)' : 'Web'}
Group ID: ${debugInfo.groupId || 'none'}
Permission: ${debugInfo.permission || 'not checked'}
Has Token: ${debugInfo.hasToken ? 'yes' : 'no'}
Token: ${debugInfo.tokenPreview || 'none'}
Error: ${debugInfo.error || 'none'}
          `.trim()}
          confirmLabel="Try subscribe"
          cancelLabel="Close"
          onConfirm={async () => {
            setShowDebug(false);
            if (isNative) {
              await subscribeNative();
            } else {
              await subscribeWeb();
            }
          }}
          onCancel={() => setShowDebug(false)}
        />
      )}

      {showTestModal && (
        <Modal title="Test notifications" onClose={() => setShowTestModal(false)}>
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              <p className="mb-2">
                <strong>State:</strong> {state}
              </p>
              <p className="mb-2">
                <strong>Token:</strong> {getCurrentToken() ? 'Ready' : 'Not registered'}
              </p>
            </div>

            <button
              onClick={sendTestNotification}
              disabled={isSendingTest || !getCurrentToken()}
              className="w-full py-3 px-4 bg-accent text-white rounded-lg font-medium disabled:opacity-50"
            >
              {isSendingTest ? 'Sending...' : 'Send test notification'}
            </button>

            {testResult && (
              <pre
                className={`text-sm p-3 rounded-lg overflow-x-auto whitespace-pre-wrap ${
                  testResult.startsWith('ERROR:')
                    ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    : testResult.startsWith('SUCCESS:')
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      : 'bg-surface-elevated'
                }`}
              >
                {testResult.replace(/^(ERROR:|SUCCESS:)/, '')}
              </pre>
            )}

            <button
              onClick={() => setShowTestModal(false)}
              className="w-full py-2 px-4 border border-border rounded-lg"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
