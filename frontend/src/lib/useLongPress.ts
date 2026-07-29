import { useRef, useCallback, useEffect, useState } from 'react';

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
  onTouchCancel: () => void;
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

  // A press in progress when the component goes away must not still fire.
  useEffect(() => clearTimer, [clearTimer]);

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

        // If long press already triggered, dismiss it when finger moves.
        // longPressTriggeredRef deliberately stays set: the click that ends
        // this touch is the tail of a long press, not a tap, so it must still
        // be swallowed. It can't leak into the next gesture — every
        // touchstart clears it before a new click can be produced.
        if (longPressTriggeredRef.current) {
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

  // iOS fires touchcancel instead of touchend when the system steals the touch
  // (edge swipe, incoming call, scroll takeover). No touchend and no click
  // follow it, so this touch's state has to be unwound here: a pending timer
  // would otherwise fire a long press with no finger on the screen, and a
  // long press that already fired would leave the click guard armed for
  // whatever the user taps next.
  const handleTouchCancel = useCallback(() => {
    clearTimer();
    startPosRef.current = null;

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
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
    onTouchCancel: handleTouchCancel,
    onClick: handleClick,
    isLongPressing,
  };
}
