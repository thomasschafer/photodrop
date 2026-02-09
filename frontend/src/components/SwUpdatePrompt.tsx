import { useState, useEffect } from 'react';

/**
 * Shows a banner when a new service worker is waiting to activate.
 * User clicks "Update" to activate the new SW and reload.
 */
export function SwUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleControllerChange = () => {
      window.location.reload();
    };

    const checkForWaiting = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        setWaitingWorker(registration.waiting);
        setShowPrompt(true);
      }

      // Listen for new service workers
      registration?.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
            setShowPrompt(true);
          }
        });
      });
    };

    checkForWaiting();
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
      <div className="bg-surface border border-border rounded-lg shadow-elevated p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">A new version is available!</p>
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer flex-shrink-0"
        >
          Update
        </button>
      </div>
    </div>
  );
}
