import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthenticatedImage, clearImageCache } from './useAuthenticatedImage';

// Declare global for Node.js environment in tests
declare const global: typeof globalThis;

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
  CapacitorHttp: {
    get: vi.fn(),
  },
}));

// Import mocked modules
import { Capacitor, CapacitorHttp } from '@capacitor/core';

describe('useAuthenticatedImage', () => {
  const mockToken = 'test-access-token';
  const mockPhotoId = 'photo-123';
  const mockBlob = new Blob(['test'], { type: 'image/jpeg' });

  beforeEach(() => {
    // Clear mocks and cache
    vi.clearAllMocks();
    clearImageCache();

    // Setup localStorage mock
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'accessToken') return mockToken;
      return null;
    });

    // Setup fetch mock for web
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    // Setup URL.createObjectURL mock
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('web platform', () => {
    beforeEach(() => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    it('fetches image with Authorization header', async () => {
      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/photos/${mockPhotoId}/thumbnail`),
        expect.objectContaining({
          headers: { Authorization: `Bearer ${mockToken}` },
        })
      );
    });

    it('returns blob URL on success', async () => {
      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.src).toBe('blob:test-url');
      expect(result.current.error).toBeNull();
    });

    it('returns error on fetch failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.src).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it('caches images and reuses on subsequent calls', async () => {
      const { result: result1 } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      // Second call should use cache
      const { result: result2 } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      // Should return cached value immediately
      expect(result2.current.src).toBe('blob:test-url');
      expect(result2.current.loading).toBe(false);

      // Fetch should only have been called once
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('native platform', () => {
    beforeEach(() => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    });

    it('uses CapacitorHttp with Authorization header', async () => {
      const mockBase64 = btoa('test-image-data');
      vi.mocked(CapacitorHttp.get).mockResolvedValue({
        status: 200,
        data: mockBase64,
        headers: { 'content-type': 'image/jpeg' },
        url: '',
      });

      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(CapacitorHttp.get).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { Authorization: `Bearer ${mockToken}` },
          responseType: 'blob',
        })
      );
    });

    it('returns blob URL from base64 response', async () => {
      const mockBase64 = btoa('test-image-data');
      vi.mocked(CapacitorHttp.get).mockResolvedValue({
        status: 200,
        data: mockBase64,
        headers: { 'content-type': 'image/jpeg' },
        url: '',
      });

      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.src).toBe('blob:test-url');
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
  });

  describe('clearImageCache', () => {
    it('revokes all blob URLs and clears cache', async () => {
      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      clearImageCache();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});
