import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetInstallPromptStateForTests, useInstallPrompt } from './useInstallPrompt';

describe('useInstallPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInstallPromptStateForTests();

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

  describe('PWA standalone detection', () => {
    it('returns isInstalled=false in a plain browser tab', () => {
      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.isInstalled).toBe(false);
    });

    it('detects standalone mode via matchMedia', () => {
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
      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(true);
    });

    it('returns false when installed', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(false);
    });

    it('returns false when dismissed', () => {
      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.shouldShowPrompt).toBe(false);
      expect(result.current.isDismissed).toBe(true);
    });

    it('keeps Later snoozed across remounts for seven days', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
        JSON.stringify({ dismissedAt: Date.now() - 60_000 })
      );

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(false);
    });

    it('shows the prompt again after the seven-day snooze expires', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
        JSON.stringify({ dismissedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 })
      );

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.shouldShowPrompt).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('permanently dismisses when called with true', () => {
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
      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss(false);
      });

      expect(result.current.isDismissed).toBe(true);
      // “Later” is a seven-day snooze, so it survives a remount/logout.
      expect(Storage.prototype.setItem).toHaveBeenCalledWith(
        'installPrompt',
        expect.stringContaining('dismissedAt')
      );
    });

    it('still dismisses when localStorage refuses the write', () => {
      // Private browsing / restricted webviews / quota pressure make setItem
      // throw. The dismissal is a convenience, so it must not blow up out of
      // the click handler that triggered it.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        result.current.dismiss(true);
      });

      expect(result.current.isDismissed).toBe(true);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('platform detection', () => {
    it('detects Firefox', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
        configurable: true,
      });

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.platform).toBe('firefox');
      expect(result.current.canSkipInstall).toBe(true);
    });
  });

  it('uses and clears a captured native install prompt', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' }>;
    };
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    const { result } = renderHook(() => useInstallPrompt());

    act(() => window.dispatchEvent(event));
    expect(result.current.canPromptNatively).toBe(true);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.triggerNativePrompt();
    });

    expect(outcome).toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current.canPromptNatively).toBe(false);
    expect(result.current.isInstalled).toBe(true);
  });

  it('retains a native prompt fired before any install UI mounts', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' }>;
    };
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });

    window.dispatchEvent(event);
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canPromptNatively).toBe(true);
    await act(async () => {
      await result.current.triggerNativePrompt();
    });
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('does not downgrade a permanent dismissal when the native prompt is dismissed', async () => {
    let stored = JSON.stringify({ dismissed: true, dismissedAt: Date.now() - 1000 });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => stored);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((_key, value) => {
      stored = value;
    });
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'dismissed' }>;
    };
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
    const { result } = renderHook(() => useInstallPrompt());

    await act(async () => {
      await result.current.triggerNativePrompt();
    });

    expect(JSON.parse(stored)).toMatchObject({ dismissed: true });
  });
});
