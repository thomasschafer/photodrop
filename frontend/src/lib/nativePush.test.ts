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
});
