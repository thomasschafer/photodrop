import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVirtualCarousel } from './useVirtualCarousel';

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
});
