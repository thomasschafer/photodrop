import { useRef, useCallback, useState } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onLongPressEnd?: () => void;
  delay?: number;
  moveThreshold?: number;
}

interface UseLongPressReturn {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onClick: (e: React.MouseEvent) => void;
  isLongPressing: boolean;
}

export function useLongPress({
  onLongPress,
  onLongPressEnd,
  delay = 500,
  moveThreshold = 10,
}: UseLongPressOptions): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [isLongPressing, setIsLongPressing] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      longPressTriggeredRef.current = false;
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };

      timerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        setIsLongPressing(true);
        onLongPress();
      }, delay);
    },
    [delay, onLongPress]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current) return;

      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
      const deltaY = Math.abs(touch.clientY - startPosRef.current.y);

      if (deltaX > moveThreshold || deltaY > moveThreshold) {
        clearTimer();
        startPosRef.current = null;

        // If long press already triggered, dismiss it when finger moves
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          setIsLongPressing(false);
          onLongPressEnd?.();
        }
      }
    },
    [moveThreshold, clearTimer, onLongPressEnd]
  );

  const handleTouchEnd = useCallback(() => {
    clearTimer();
    startPosRef.current = null;

    if (longPressTriggeredRef.current) {
      setIsLongPressing(false);
      onLongPressEnd?.();
    }
  }, [clearTimer, onLongPressEnd]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggeredRef.current = false;
    }
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onClick: handleClick,
    isLongPressing,
  };
}
