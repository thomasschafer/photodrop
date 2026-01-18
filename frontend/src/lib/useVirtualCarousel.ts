import { useRef, useState, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';

const DEFAULT_WINDOW_SIZE = 5;
const VELOCITY_THRESHOLD_PX_PER_MS = 0.3;
const EDGE_RESISTANCE_FACTOR = 0.3;
const ANIMATION_DURATION_MS = 300;

interface UseVirtualCarouselOptions {
  totalCount: number;
  initialIndex: number;
  onIndexChange: (index: number) => void;
  windowSize?: number;
  excludeRef?: React.RefObject<HTMLElement | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
}

interface UseVirtualCarouselReturn {
  centerIndex: number;
  offset: number;
  isAnimating: boolean;
  visibleIndices: number[];
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  reset: (newIndex?: number) => void;
}

interface CarouselState {
  centerIndex: number;
  offset: number;
}

export function useVirtualCarousel({
  totalCount,
  initialIndex,
  onIndexChange,
  windowSize = DEFAULT_WINDOW_SIZE,
  excludeRef,
  containerRef,
}: UseVirtualCarouselOptions): UseVirtualCarouselReturn {
  // Combined state for atomic updates
  const [state, setState] = useState<CarouselState>({
    centerIndex: initialIndex,
    offset: 0,
  });
  const { centerIndex, offset } = state;

  // Keep a ref in sync for synchronous reads
  const centerIndexRef = useRef(initialIndex);

  // isAnimating: whether we're animating to snap to a photo
  const [isAnimating, setIsAnimating] = useState(false);

  // Track the virtual position during drag (fractional, e.g., 3.7 = 70% toward photo 4)
  const virtualIndexRef = useRef(initialIndex);
  // Track touch state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the virtual index at the start of a drag (captured once at touch start)
  const dragStartVirtualIndexRef = useRef<number>(initialIndex);

  // Store the index we're animating to, for the callback
  const targetIndexRef = useRef<number | null>(null);
  // Track whether we're currently dragging (to prevent external resets mid-drag)
  const isDraggingRef = useRef(false);

  // Track the callback in a ref so we can call the latest version
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  // Reset function - called when photo changes externally (e.g., keyboard nav)
  // Returns true if reset was performed, false if skipped (e.g., during drag)
  const reset = useCallback((newIndex?: number): boolean => {
    // Don't reset during an active drag
    if (isDraggingRef.current) {
      return false;
    }
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    const idx = newIndex ?? virtualIndexRef.current;
    virtualIndexRef.current = idx;
    centerIndexRef.current = idx;
    setState({ centerIndex: idx, offset: 0 });
    setIsAnimating(false);
    touchStartRef.current = null;
    isHorizontalSwipeRef.current = null;
    targetIndexRef.current = null;
    return true;
  }, []);

  // Compute visible indices based on center
  // Always include windowSize indices to keep DOM structure consistent
  // (out-of-bounds indices will be rendered as empty placeholders)
  const halfWindow = Math.floor(windowSize / 2);
  const visibleIndices: number[] = [];
  for (let i = -halfWindow; i <= halfWindow; i++) {
    visibleIndices.push(centerIndex + i);
  }

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Don't start swipe if touch is inside excluded element
      if (excludeRef?.current?.contains(e.target as Node)) {
        touchStartRef.current = null;
        return;
      }

      // If we're animating, take over from current position
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      setIsAnimating(false);

      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      isHorizontalSwipeRef.current = null;
      // Capture the current virtual index at drag start
      dragStartVirtualIndexRef.current = virtualIndexRef.current;
      isDraggingRef.current = true;
    },
    [excludeRef]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Determine swipe direction on first significant movement
      if (isHorizontalSwipeRef.current === null) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Need at least 10px of movement to determine direction
        if (absX < 10 && absY < 10) return;

        isHorizontalSwipeRef.current = absX > absY;

        if (!isHorizontalSwipeRef.current) {
          // Vertical scroll - don't interfere
          return;
        }
      }

      if (!isHorizontalSwipeRef.current) return;

      // Prevent vertical scrolling while swiping horizontally
      e.preventDefault();

      const slideWidth = containerRef?.current?.offsetWidth ?? window.innerWidth;

      // Calculate how many "slides" we've moved (fractional)
      // Negative deltaX (swipe left) = moving to higher indices
      const slidesDelta = -deltaX / slideWidth;

      // Start from the virtual index captured at drag start
      const startIndex = dragStartVirtualIndexRef.current;
      let newVirtualIndex = startIndex + slidesDelta;

      // Clamp with resistance at edges
      if (newVirtualIndex < 0) {
        // Apply resistance - the further past 0, the more resistance
        newVirtualIndex = newVirtualIndex * EDGE_RESISTANCE_FACTOR;
      } else if (newVirtualIndex > totalCount - 1) {
        // Apply resistance at end
        const overshoot = newVirtualIndex - (totalCount - 1);
        newVirtualIndex = totalCount - 1 + overshoot * EDGE_RESISTANCE_FACTOR;
      }

      virtualIndexRef.current = newVirtualIndex;

      // Determine the new center for the rendered window
      const newCenterIndex = Math.max(0, Math.min(totalCount - 1, Math.round(newVirtualIndex)));

      // Calculate offset within the current window
      // Offset is how far we are from centerIndex, in pixels
      const offsetFromCenter = (newVirtualIndex - newCenterIndex) * slideWidth;

      // Update center index and offset atomically
      centerIndexRef.current = newCenterIndex;
      setState({ centerIndex: newCenterIndex, offset: -offsetFromCenter });
    },
    [totalCount, containerRef]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || !isHorizontalSwipeRef.current) {
        touchStartRef.current = null;
        isHorizontalSwipeRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaTime = Date.now() - touchStartRef.current.time;

      // Calculate velocity (pixels per ms)
      const velocity = deltaX / deltaTime;

      touchStartRef.current = null;
      isHorizontalSwipeRef.current = null;
      // Keep isDraggingRef true until animation completes to prevent external resets

      const currentVirtualIndex = virtualIndexRef.current;

      // Determine target index based on position and velocity
      let targetIndex: number;

      // Velocity threshold: if moving fast enough, go to next/prev
      const velocityThreshold = VELOCITY_THRESHOLD_PX_PER_MS;

      if (Math.abs(velocity) > velocityThreshold) {
        // Use velocity to determine direction
        if (velocity > 0) {
          // Swiping right = going to previous
          targetIndex = Math.floor(currentVirtualIndex);
        } else {
          // Swiping left = going to next
          targetIndex = Math.ceil(currentVirtualIndex);
        }
      } else {
        // Snap to nearest
        targetIndex = Math.round(currentVirtualIndex);
      }

      // Clamp to valid range
      targetIndex = Math.max(0, Math.min(totalCount - 1, targetIndex));

      // Animate to target
      virtualIndexRef.current = targetIndex;
      targetIndexRef.current = targetIndex;

      // Calculate the offset needed to show targetIndex while keeping centerIndex stable
      // This prevents DOM reordering mid-animation which causes visual jumps
      const slideWidth = containerRef?.current?.offsetWidth ?? window.innerWidth;
      const currentCenterIndex = centerIndexRef.current;
      const targetOffset = -(targetIndex - currentCenterIndex) * slideWidth;

      // Enable animation, then set target offset in next frame
      setIsAnimating(true);

      requestAnimationFrame(() => {
        setState((prev) => ({ ...prev, offset: targetOffset }));
      });

      // After animation completes, update centerIndex to target and reset offset
      animationTimeoutRef.current = setTimeout(() => {
        // Use flushSync to force synchronous DOM update, preventing intermediate render states
        flushSync(() => {
          setIsAnimating(false);
          centerIndexRef.current = targetIndex;
          setState({ centerIndex: targetIndex, offset: 0 });
        });

        isDraggingRef.current = false;
        animationTimeoutRef.current = null;

        if (targetIndexRef.current !== null) {
          onIndexChangeRef.current(targetIndexRef.current);
          targetIndexRef.current = null;
        }
      }, ANIMATION_DURATION_MS);
    },
    [totalCount, containerRef]
  );

  return {
    centerIndex,
    offset,
    isAnimating,
    visibleIndices,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    reset,
  };
}
