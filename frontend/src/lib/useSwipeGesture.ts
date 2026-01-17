import { useRef, useState, useCallback, useEffect } from 'react';

interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeThreshold?: number;
  velocityThreshold?: number;
  resistanceAtEdges?: boolean;
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
  animationDuration?: number;
  excludeRef?: React.RefObject<HTMLElement | null>;
}

interface UseSwipeGestureReturn {
  offset: number;
  isAnimating: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  reset: () => void;
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  swipeThreshold = 50,
  velocityThreshold = 0.3,
  resistanceAtEdges = true,
  canSwipeLeft = true,
  canSwipeRight = true,
  animationDuration = 300,
  excludeRef,
}: UseSwipeGestureOptions): UseSwipeGestureReturn {
  const [offset, setOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Track pending navigation to trigger after animation completes
  const pendingNavigationRef = useRef<'left' | 'right' | null>(null);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  // Store callbacks in refs so we can call them after animation
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
  }, [onSwipeLeft, onSwipeRight]);

  // Cleanup timeout on unmount to prevent firing on unmounted component
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    pendingNavigationRef.current = null;
    setOffset(0);
    setIsAnimating(false);
    touchStartRef.current = null;
    isHorizontalSwipeRef.current = null;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Don't start swipe if touch is inside excluded element
      if (excludeRef?.current?.contains(e.target as Node)) {
        touchStartRef.current = null;
        return;
      }

      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      isHorizontalSwipeRef.current = null;
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

      let newOffset = deltaX;

      // Apply resistance at edges
      if (resistanceAtEdges) {
        if (deltaX > 0 && !canSwipeRight) {
          // Trying to swipe right but at first photo
          newOffset = deltaX * 0.3;
        } else if (deltaX < 0 && !canSwipeLeft) {
          // Trying to swipe left but at last photo
          newOffset = deltaX * 0.3;
        }
      }

      setOffset(newOffset);
    },
    [resistanceAtEdges, canSwipeLeft, canSwipeRight]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || !isHorizontalSwipeRef.current) {
        reset();
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaTime = Date.now() - touchStartRef.current.time;
      const velocity = Math.abs(deltaX) / deltaTime;

      // Determine if swipe should complete navigation
      const shouldComplete = Math.abs(deltaX) > swipeThreshold || velocity > velocityThreshold;

      touchStartRef.current = null;
      isHorizontalSwipeRef.current = null;

      if (shouldComplete) {
        if (deltaX < 0 && canSwipeLeft) {
          // Animate to fully show next slide, then navigate
          setIsAnimating(true);
          setOffset(-window.innerWidth);
          pendingNavigationRef.current = 'left';

          animationTimeoutRef.current = setTimeout(() => {
            // Don't reset offset here - let the consumer reset after navigation
            // via useLayoutEffect to avoid flashing old content
            onSwipeLeftRef.current?.();
            animationTimeoutRef.current = null;
          }, animationDuration);
          return;
        } else if (deltaX > 0 && canSwipeRight) {
          // Animate to fully show previous slide, then navigate
          setIsAnimating(true);
          setOffset(window.innerWidth);
          pendingNavigationRef.current = 'right';

          animationTimeoutRef.current = setTimeout(() => {
            // Don't reset offset here - let the consumer reset after navigation
            // via useLayoutEffect to avoid flashing old content
            onSwipeRightRef.current?.();
            animationTimeoutRef.current = null;
          }, animationDuration);
          return;
        }
      }

      // Swipe cancelled or can't navigate - animate back to center
      setIsAnimating(true);
      setOffset(0);
    },
    [swipeThreshold, velocityThreshold, canSwipeLeft, canSwipeRight, animationDuration, reset]
  );

  return {
    offset,
    isAnimating,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    reset,
  };
}
