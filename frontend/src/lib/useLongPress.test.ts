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
