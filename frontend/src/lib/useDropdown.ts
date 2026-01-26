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

  // Handle blur (tab out)
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
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
