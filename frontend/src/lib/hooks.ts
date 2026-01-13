import { useRef, useCallback, useSyncExternalStore, type RefObject } from 'react';

export function useFocusRestore<T extends HTMLElement>(): [RefObject<T | null>, () => void] {
  const ref = useRef<T | null>(null);
  const restore = useCallback(() => ref.current?.focus(), []);
  return [ref, restore];
}

function subscribeToOnlineStatus(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getOnlineServerSnapshot() {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeToOnlineStatus, getOnlineSnapshot, getOnlineServerSnapshot);
}
