import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

import { Capacitor } from '@capacitor/core';

describe('useInstallPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    // Mock matchMedia for standalone detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Reset navigator.standalone
    Object.defineProperty(navigator, 'standalone', {
      writable: true,
      value: undefined,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('native platform detection', () => {
    it('returns isInstalled=true when running in native Capacitor app', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.isInstalled).toBe(true);
      expect(result.current.shouldShowPrompt).toBe(false);
    });

    it('returns isInstalled=false on web browser', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.isInstalled).toBe(false);
    });
  });

  describe('PWA standalone detection', () => {
    it('detects standalone mode via matchMedia', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.isInstalled).toBe(true);
    });

    it('detects iOS standalone mode via navigator.standalone', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      });

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.isInstalled).toBe(true);
    });
  });

  describe('shouldShowPrompt', () => {
    it('returns true when not installed and not dismissed', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(true);
    });

    it('returns false when installed', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(false);
    });

    it('returns false when dismissed', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.shouldShowPrompt).toBe(false);
      expect(result.current.isDismissed).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('permanently dismisses when called with true', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss(true);
      });

      expect(Storage.prototype.setItem).toHaveBeenCalledWith(
        'installPrompt',
        expect.stringContaining('"dismissed":true')
      );
    });

    it('temporarily dismisses when called with false', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss(false);
      });

      expect(result.current.isDismissed).toBe(true);
      // Should not persist to localStorage
      expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    });
  });

  describe('platform detection', () => {
    it('detects Firefox', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
        configurable: true,
      });

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.platform).toBe('firefox');
      expect(result.current.canSkipInstall).toBe(true);
    });
  });
});
