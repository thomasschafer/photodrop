import { useRef, useCallback, type RefObject } from 'react';

export function useFocusRestore<T extends HTMLElement>(): [RefObject<T | null>, () => void] {
  const ref = useRef<T | null>(null);
  const restore = useCallback(() => ref.current?.focus(), []);
  return [ref, restore];
}
