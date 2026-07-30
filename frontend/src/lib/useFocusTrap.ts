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
    // Skip invisible candidates: focus() on a display:none element no-ops,
    // which under per-press interception would make Tab appear dead. Guarded
    // on checkVisibility existing (absent in the jsdom test harness, where
    // nothing has layout), so this filter is browser-only.
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true)
    );
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      // The trap moves focus itself on *every* Tab press rather than letting
      // the browser walk sequential focus order and only correcting at the
      // ends. Handing the middle of the cycle to the browser assumes every
      // engine tabs through the same elements — Safari's default keyboard
      // behaviour never tabs onto buttons, so with boundary-only interception
      // focus walks straight out of the dialog and button-only controls
      // (Cancel, Save) are unreachable there.
      e.preventDefault();

      // Focus can sit entirely outside the trapped container — clicking a
      // non-interactive part of the overlay (the photo itself, the padding
      // around a comment list) blurs to <body>. Tab from there would walk the
      // page *behind* the overlay, which for an aria-modal dialog is content
      // assistive tech has been told does not exist. Pull it back in, entering
      // at the end for shift-Tab so the cycle direction still reads naturally.
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const delta = e.shiftKey ? -1 : 1;
      const nextIndex =
        currentIndex === -1
          ? e.shiftKey
            ? focusable.length - 1
            : 0
          : (currentIndex + delta + focusable.length) % focusable.length;

      focusable[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, getFocusableElements, containerRef]);
}
