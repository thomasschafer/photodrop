import { useEffect, useRef, useCallback } from 'react';
import { getNavDirection } from './keyboard';

interface UseDropdownOptions {
  isOpen: boolean;
  onClose: () => void;
  itemCount: number;
  initialFocusIndex?: number;
  horizontal?: boolean;
  closeOnScroll?: boolean;
}

interface UseDropdownReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  setOptionRef: (index: number) => (el: HTMLButtonElement | null) => void;
  handleOptionKeyDown: (e: React.KeyboardEvent, index: number) => void;
  handleBlur: (e: React.FocusEvent) => void;
}

export function useDropdown({
  isOpen,
  onClose,
  itemCount,
  initialFocusIndex = 0,
  horizontal = false,
  closeOnScroll = false,
}: UseDropdownOptions): UseDropdownReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusOption = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, itemCount - 1));
      optionRefs.current[clampedIndex]?.focus();
    },
    [itemCount]
  );

  // Focus initial option when dropdown opens
  useEffect(() => {
    if (isOpen) {
      const index = initialFocusIndex >= 0 && initialFocusIndex < itemCount ? initialFocusIndex : 0;
      optionRefs.current[index]?.focus();
    }
  }, [isOpen, initialFocusIndex, itemCount]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    const handleScroll = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (closeOnScroll) {
      document.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (closeOnScroll) {
        document.removeEventListener('scroll', handleScroll, true);
      }
    };
  }, [isOpen, onClose, closeOnScroll]);

  // Keep focus inside the dropdown during mouse interaction. macOS Safari
  // never focuses <button>s on mousedown — it moves focus to the nearest
  // mouse-focusable ancestor instead. When the dropdown sits inside one (e.g.
  // the feed's tabIndex={0} photo cards), mousedown on an option would focus
  // that ancestor, and the resulting blur closes the dropdown and unmounts
  // the option before its click event fires — the selection is silently
  // lost. Preventing the default suppresses the focus move; the trigger is
  // then focused explicitly so toggling the dropdown from its trigger
  // behaves the same in every browser.
  //
  // This assumes dropdown content is buttons only (true of every consumer):
  // suppressing mousedown's default also suppresses click-to-focus, so a text
  // input added inside a dropdown would need to be exempted here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      if (triggerRef.current?.contains(e.target as Node)) {
        triggerRef.current.focus();
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    return () => container.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Handle blur (keyboard tab-out). A null relatedTarget means focus didn't
  // move to another element — notably on iOS Safari, tapping a button doesn't
  // focus it, so the auto-focused option blurs with no relatedTarget. Closing
  // here would unmount the option before its click registers, so the tap never
  // selects anything. Outside taps are handled by the mousedown listener above,
  // so this path only needs to close on a real tab-out (relatedTarget present).
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!e.relatedTarget) return;
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  // Keyboard navigation for options
  const handleOptionKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const direction = getNavDirection(e);
      const nextKey = horizontal ? 'right' : 'down';
      const prevKey = horizontal ? 'left' : 'up';

      if (direction === nextKey) {
        e.preventDefault();
        focusOption(index + 1);
      } else if (direction === prevKey) {
        e.preventDefault();
        focusOption(index - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusOption(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusOption(itemCount - 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
        onClose();
        triggerRef.current?.focus();
      }
    },
    [horizontal, focusOption, itemCount, onClose]
  );

  const setOptionRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      optionRefs.current[index] = el;
    },
    []
  );

  return {
    containerRef,
    triggerRef,
    setOptionRef,
    handleOptionKeyDown,
    handleBlur,
  };
}
