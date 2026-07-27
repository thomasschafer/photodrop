import { useState, useEffect, useRef } from 'react';
import { Button } from './Button';

/**
 * Shows a banner when a new service worker is waiting to activate.
 * User clicks "Update" to activate the new SW and reload.
 */
export function SwUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  // Set when the user accepts the update, so we only reload for an explicit
  // update — not the first-install controllerchange from clientsClaim().
  const userAcceptedUpdate = useRef(false);

  useEffect(() => {
    if (!navigator.serviceWorker) return;

    const handleControllerChange = () => {
      if (!userAcceptedUpdate.current) return;
      window.location.reload();
    };

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;

    const handleUpdateFound = () => {
      const newWorker = registration?.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingWorker(newWorker);
          setShowPrompt(true);
        }
      });
    };

    // The browser only checks for a new worker on navigation, and an installed
    // iOS PWA is resumed far more often than it is navigated — it can run for
    // days without ever noticing a deploy. Ask explicitly on every foreground.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      registration?.update().catch((error) => {
        console.error('Service worker update check failed:', error);
      });
    };

    const checkForWaiting = async () => {
      const found = await navigator.serviceWorker.getRegistration();
      // Unmounted while getRegistration was in flight: the cleanup below has
      // already run, so attaching now would leave updatefound bound forever.
      if (cancelled || !found) return;
      registration = found;

      if (found.waiting) {
        setWaitingWorker(found.waiting);
        setShowPrompt(true);
      }

      // Listen for new service workers
      found.addEventListener('updatefound', handleUpdateFound);
    };

    checkForWaiting().catch((error) => {
      console.error('Failed to inspect the service worker registration:', error);
    });
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      document.removeEventListener('visibilitychange', handleVisibility);
      registration?.removeEventListener('updatefound', handleUpdateFound);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      userAcceptedUpdate.current = true;
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
      <div className="bg-surface border border-border rounded-lg shadow-elevated p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">A new version is available!</p>
        <Button onClick={handleUpdate} size="sm" className="flex-shrink-0">
          Update
        </Button>
      </div>
    </div>
  );
}
