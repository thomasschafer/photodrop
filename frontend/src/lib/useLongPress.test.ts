import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from './useLongPress';

function createTouchEvent(clientX: number, clientY: number): React.TouchEvent {
  return {
    touches: [{ clientX, clientY }],
  } as unknown as React.TouchEvent;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onLongPress after delay when touch held', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onLongPress if touch released early', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.onTouchEnd();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels long press if finger moves beyond threshold', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      result.current.onTouchMove(createTouchEvent(120, 100)); // 20px movement
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not cancel if finger movement is within threshold', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      result.current.onTouchMove(createTouchEvent(105, 105)); // 5px movement
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('prevents click after long press triggered', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const clickEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.onClick(clickEvent);
    });

    expect(clickEvent.preventDefault).toHaveBeenCalled();
    expect(clickEvent.stopPropagation).toHaveBeenCalled();
  });

  it('does not prevent click if long press was not triggered', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    const clickEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.onClick(clickEvent);
    });

    expect(clickEvent.preventDefault).not.toHaveBeenCalled();
    expect(clickEvent.stopPropagation).not.toHaveBeenCalled();
  });

  it('uses custom delay', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, delay: 1000 }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('calls onLongPressEnd when touch ends after long press', () => {
    const onLongPress = vi.fn();
    const onLongPressEnd = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onLongPressEnd }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPressEnd).not.toHaveBeenCalled();

    act(() => {
      result.current.onTouchEnd();
    });

    expect(onLongPressEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call onLongPressEnd if long press was not triggered', () => {
    const onLongPress = vi.fn();
    const onLongPressEnd = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onLongPressEnd }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.onTouchEnd();
    });

    expect(onLongPressEnd).not.toHaveBeenCalled();
  });

  it('sets isLongPressing to true during long press', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    expect(result.current.isLongPressing).toBe(false);

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    expect(result.current.isLongPressing).toBe(false);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.isLongPressing).toBe(true);

    act(() => {
      result.current.onTouchEnd();
    });

    expect(result.current.isLongPressing).toBe(false);
  });

  it('still suppresses the click that ends a long press the finger moved out of', () => {
    // The touch that fired the long press is not a tap, however it ends, so
    // the click browsers emit when the finger lifts must not toggle anything.
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      result.current.onTouchMove(createTouchEvent(120, 100));
    });
    act(() => {
      result.current.onTouchEnd();
    });

    const clickEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.onClick(clickEvent);
    });

    expect(clickEvent.preventDefault).toHaveBeenCalled();
    // Stopping propagation is the half that matters here: the pill sits inside
    // a photo whose own click handler opens the lightbox.
    expect(clickEvent.stopPropagation).toHaveBeenCalled();
  });

  it('cancels a pending long press on touchcancel', () => {
    // iOS sends touchcancel instead of touchend when it takes the gesture
    // over, and no click follows. A timer left running would fire with no
    // finger on the screen.
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });
    act(() => {
      result.current.onTouchCancel();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('disarms the click guard on touchcancel so the next tap is not swallowed', () => {
    // No click follows a cancel, so a long press that already fired would
    // leave the guard armed — and eat whatever the user tapped next.
    const onLongPress = vi.fn();
    const onLongPressEnd = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onLongPressEnd }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onTouchCancel();
    });
    expect(onLongPressEnd).toHaveBeenCalledTimes(1);
    expect(result.current.isLongPressing).toBe(false);

    const clickEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
    act(() => {
      result.current.onClick(clickEvent);
    });

    expect(clickEvent.preventDefault).not.toHaveBeenCalled();
    // The tap has to reach the parent too, not merely act on its own target.
    expect(clickEvent.stopPropagation).not.toHaveBeenCalled();
  });

  it('does not fire a long press queued when the component unmounts', () => {
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('calls onLongPressEnd when finger moves after long press triggered', () => {
    const onLongPress = vi.fn();
    const onLongPressEnd = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onLongPressEnd }));

    act(() => {
      result.current.onTouchStart(createTouchEvent(100, 100));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPressEnd).not.toHaveBeenCalled();
    expect(result.current.isLongPressing).toBe(true);

    act(() => {
      result.current.onTouchMove(createTouchEvent(120, 100)); // 20px movement
    });

    expect(onLongPressEnd).toHaveBeenCalledTimes(1);
    expect(result.current.isLongPressing).toBe(false);
  });
});
