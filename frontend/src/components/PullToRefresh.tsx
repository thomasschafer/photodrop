import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';

const PULL_THRESHOLD = 80; // px to trigger refresh
const MAX_PULL_DISTANCE = 120; // max visual pull distance
const RESISTANCE = 0.4; // how much resistance when pulling

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
}

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Only enable on native platforms
  const isNative = Capacitor.isNativePlatform();

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!isNative || isRefreshing) return;

      // Only start pull if page is scrolled to top
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      if (scrollTop > 5) return;

      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    },
    [isNative, isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const rawDistance = currentY - startY.current;

      // Only pull down, not up
      if (rawDistance <= 0) {
        setPullDistance(0);
        return;
      }

      // Check again if we're at top (user might have scrolled during touch)
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      if (scrollTop > 5) {
        isPulling.current = false;
        setPullDistance(0);
        return;
      }

      // Apply resistance and clamp
      const resistedDistance = rawDistance * RESISTANCE;
      const clampedDistance = Math.min(resistedDistance, MAX_PULL_DISTANCE);
      setPullDistance(clampedDistance);

      // Prevent scroll while pulling
      if (clampedDistance > 10) {
        e.preventDefault();
      }
    },
    [isRefreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    const shouldRefresh = pullDistance >= PULL_THRESHOLD;

    if (shouldRefresh) {
      setIsRefreshing(true);
      setPullDistance(60); // Hold at loading position

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  // Handle touch cancel (e.g., incoming call, gesture interrupted)
  const handleTouchCancel = useCallback(() => {
    if (!isPulling.current) return;
    isPulling.current = false;
    setIsRefreshing(false);
    setPullDistance(0);
  }, []);

  // Attach touch listeners to document for better gesture capture
  useEffect(() => {
    if (!isNative) return;

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [isNative, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  // Don't add any wrapper behavior on web
  if (!isNative) {
    return <div className={className}>{children}</div>;
  }

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const rotation = progress * 180;

  return (
    <div className={`relative ${className || ''}`}>
      {/* Pull indicator - positioned relative to this container (already below header) */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none z-10 transition-opacity duration-150"
        style={{
          top: Math.max(0, pullDistance - 40),
          opacity: pullDistance > 10 ? 1 : 0,
        }}
      >
        <div className="w-10 h-10 rounded-full bg-surface border border-border shadow-lg flex items-center justify-center">
          {isRefreshing ? (
            <div className="spinner spinner-sm" />
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent transition-transform duration-100"
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <polyline points="7,13 12,18 17,13" />
              <line x1="12" y1="18" x2="12" y2="6" />
            </svg>
          )}
        </div>
      </div>

      {/* Content with pull transform */}
      <div
        ref={contentRef}
        className="transition-transform duration-150"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transitionDuration: isPulling.current ? '0ms' : '150ms',
        }}
      >
        {children}
      </div>
    </div>
  );
}
