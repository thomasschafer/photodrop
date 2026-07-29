import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVirtualCarousel } from './useVirtualCarousel';

function touchStartEvent(clientX: number, clientY: number) {
  return {
    touches: [{ clientX, clientY }],
    target: document.createElement('div'),
  } as unknown as React.TouchEvent;
}

describe('useVirtualCarousel', () => {
  it('attaches touchmove as a non-passive listener so preventDefault works', () => {
    // React's onTouchMove is registered passively (preventDefault is ignored
    // and warns). The carousel must attach touchmove itself with passive:false
    // so it can suppress the page scroll during a horizontal swipe.
    const el = document.createElement('div');
    const addSpy = vi.spyOn(el, 'addEventListener');

    renderHook(() =>
      useVirtualCarousel({
        totalCount: 3,
        initialIndex: 0,
        onIndexChange: vi.fn(),
        containerRef: { current: el },
      })
    );

    const touchmoveCall = addSpy.mock.calls.find(([type]) => type === 'touchmove');
    expect(touchmoveCall).toBeTruthy();
    expect(touchmoveCall?.[2]).toEqual({ passive: false });
  });

  it('does not expose onTouchMove as a (passive) React handler', () => {
    const { result } = renderHook(() =>
      useVirtualCarousel({ totalCount: 3, initialIndex: 0, onIndexChange: vi.fn() })
    );

    expect('onTouchMove' in result.current.handlers).toBe(false);
    expect(typeof result.current.handlers.onTouchStart).toBe('function');
    expect(typeof result.current.handlers.onTouchEnd).toBe('function');
  });

  it('unwinds a half-finished swipe on touchcancel', () => {
    // iOS Safari sends touchcancel instead of touchend when the system takes
    // the gesture (edge swipe, incoming call). Without handling it the drag
    // never ends: the offset stays frozen part-way through the swipe and
    // `reset` — which refuses to run mid-drag — is disabled for good, taking
    // the lightbox's URL-driven index sync and keyboard nav down with it.
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 300 });
    const onIndexChange = vi.fn();

    const { result } = renderHook(() =>
      useVirtualCarousel({
        totalCount: 3,
        initialIndex: 1,
        onIndexChange,
        containerRef: { current: el },
      })
    );

    act(() => {
      result.current.handlers.onTouchStart(touchStartEvent(200, 100));
    });
    act(() => {
      const move = new Event('touchmove', { cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ clientX: 140, clientY: 100 }] });
      el.dispatchEvent(move);
    });
    expect(result.current.offset).not.toBe(0);

    act(() => {
      result.current.handlers.onTouchCancel();
    });

    // Snapped back to the photo the drag started on, and no index change was
    // reported for a gesture the system threw away.
    expect(result.current.offset).toBe(0);
    expect(result.current.centerIndex).toBe(1);
    expect(onIndexChange).not.toHaveBeenCalled();

    // The drag is over, so an external reset is honoured again.
    act(() => {
      result.current.reset(2);
    });
    expect(result.current.centerIndex).toBe(2);
  });

  it('ignores a touchcancel that arrives during the post-swipe snap animation', () => {
    // touchend hands the gesture to a 300ms snap that still owns the drag flag
    // and still has an index change to report. A cancel landing in that window
    // belongs to no live touch, so unwinding there would strand the carousel
    // on the photo the swipe started from while the URL never moved.
    vi.useFakeTimers();
    try {
      const el = document.createElement('div');
      Object.defineProperty(el, 'offsetWidth', { value: 300 });
      const onIndexChange = vi.fn();

      const { result } = renderHook(() =>
        useVirtualCarousel({
          totalCount: 3,
          initialIndex: 1,
          onIndexChange,
          containerRef: { current: el },
        })
      );

      act(() => {
        result.current.handlers.onTouchStart(touchStartEvent(200, 100));
      });
      act(() => {
        const move = new Event('touchmove', { cancelable: true });
        Object.defineProperty(move, 'touches', { value: [{ clientX: 140, clientY: 100 }] });
        el.dispatchEvent(move);
      });
      act(() => {
        result.current.handlers.onTouchEnd({
          changedTouches: [{ clientX: 140, clientY: 100 }],
        } as unknown as React.TouchEvent);
      });

      act(() => {
        result.current.handlers.onTouchCancel();
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.centerIndex).toBe(2);
      expect(onIndexChange).toHaveBeenCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
