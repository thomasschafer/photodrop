import { useCallback, useEffect } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab focus cycling inside `containerRef` while `enabled`. Any full-screen
 * or overlay surface needs this: the content behind it stays in the document
 * and focusable, so without a trap Tab walks out of the dialog into a page the
 * user can't see (and a screen reader follows it there).
 *
 * Pass `enabled: false` when a nested trap takes over — both listen on the
 * document, so two active traps would fight over the same Tab press.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, enabled = true) {
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, getFocusableElements]);
}
