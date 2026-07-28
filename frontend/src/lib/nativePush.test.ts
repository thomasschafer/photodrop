import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isNativePlatform, getPlatform, getCurrentToken } from './nativePush';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
}));

// Mock PushNotifications
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn(),
  },
}));

// Mock the App plugin (the module reads app state around registration)
vi.mock('@capacitor/app', () => ({
  App: {
    getState: vi.fn(async () => ({ isActive: true })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
  },
}));

// Mock api
vi.mock('./api', () => ({
  api: {
    push: {
      registerDevice: vi.fn(),
      unregisterDevice: vi.fn(),
      getDeviceStatus: vi.fn(),
    },
  },
}));

import { Capacitor } from '@capacitor/core';

describe('nativePush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isNativePlatform', () => {
    it('returns true when running on native', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      expect(isNativePlatform()).toBe(true);
    });

    it('returns false when running on web', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      expect(isNativePlatform()).toBe(false);
    });
  });

  describe('getPlatform', () => {
    it('returns null when not native', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      expect(getPlatform()).toBeNull();
    });

    it('returns ios when on iOS native', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

      expect(getPlatform()).toBe('ios');
    });

    it('returns android when on Android native', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

      expect(getPlatform()).toBe('android');
    });

    it('returns null for unknown native platform', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('electron');

      expect(getPlatform()).toBeNull();
    });
  });

  describe('getCurrentToken', () => {
    it('returns null initially', () => {
      expect(getCurrentToken()).toBeNull();
    });
  });

  describe('registerForPush', () => {
    it('does not let a timed-out attempt fail the registration that replaced it', async () => {
      // The first attempt times out and the caller starts a second one. When
      // the first register() finally rejects, its handler must settle *its*
      // attempt — reaching for whatever resolver is current would fail a
      // registration that is still perfectly alive, and the device would end
      // up with no FCM token at all.
      vi.useFakeTimers();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.resetModules();
      try {
        const { Capacitor } = await import('@capacitor/core');
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const { registerForPush } = await import('./nativePush');

        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
        vi.mocked(PushNotifications.checkPermissions).mockResolvedValue({ receive: 'granted' });

        const listeners = new Map<string, (payload: unknown) => void>();
        vi.mocked(PushNotifications.addListener).mockImplementation(
          // The plugin's overloaded signature is far wider than the two events
          // this test drives, so the handler is registered through a cast.
          ((event: string, cb: (payload: unknown) => void) => {
            listeners.set(event, cb);
            return Promise.resolve({ remove: vi.fn() });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any
        );

        let rejectFirstRegister!: (reason: unknown) => void;
        vi.mocked(PushNotifications.register)
          .mockReturnValueOnce(
            new Promise<void>((_resolve, reject) => {
              rejectFirstRegister = reject;
            })
          )
          // The second attempt's register() resolves; the token arrives later
          // via the 'registration' event, as it does on a device.
          .mockReturnValueOnce(Promise.resolve());

        const first = registerForPush();
        await vi.advanceTimersByTimeAsync(500);
        // 10s registration timeout: the first attempt gives up.
        await vi.advanceTimersByTimeAsync(10000);
        expect(await first).toBeNull();

        const second = registerForPush();
        let secondResult: string | null | undefined;
        second.then((value) => {
          secondResult = value;
        });
        await vi.advanceTimersByTimeAsync(500);

        // The abandoned attempt's register() now rejects.
        rejectFirstRegister(new Error('plugin error'));
        await vi.advanceTimersByTimeAsync(0);
        expect(secondResult).toBeUndefined();

        listeners.get('registration')!({ value: 'fcm-token' });
        expect(await second).toBe('fcm-token');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
