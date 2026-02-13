import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthenticatedImage, clearImageCache, LRUImageCache } from './useAuthenticatedImage';

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

  describe('LRUImageCache', () => {
    let revokeObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      revokeObjectURL = vi.fn();
      global.URL.revokeObjectURL = revokeObjectURL;
    });

    it('basic get/set/has', () => {
      const cache = new LRUImageCache(3);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('a')).toBeUndefined();

      cache.set('a', 'blob:a');
      expect(cache.has('a')).toBe(true);
      expect(cache.get('a')).toBe('blob:a');
    });

    it('evicts oldest entry when full', () => {
      const cache = new LRUImageCache(3);
      cache.set('a', 'blob:a');
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c');

      // Adding a 4th should evict 'a'
      cache.set('d', 'blob:d');

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('revokes blob URL on eviction', () => {
      const cache = new LRUImageCache(2);
      cache.set('a', 'blob:a');
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c'); // evicts 'a'

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:a');
    });

    it('moves accessed entry to most-recent position', () => {
      const cache = new LRUImageCache(3);
      cache.set('a', 'blob:a');
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c');

      // Access 'a' to move it to most-recent
      cache.get('a');

      // Adding two more should evict 'b' and 'c', but not 'a'
      cache.set('d', 'blob:d');
      cache.set('e', 'blob:e');

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(false);
    });

    it('clear() revokes all URLs', () => {
      const cache = new LRUImageCache(5);
      cache.set('a', 'blob:a');
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c');

      cache.clear();

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:a');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:b');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:c');
      expect(cache.has('a')).toBe(false);
    });

    it('overwrites existing key without eviction', () => {
      const cache = new LRUImageCache(2);
      cache.set('a', 'blob:a1');
      cache.set('b', 'blob:b');
      cache.set('a', 'blob:a2'); // overwrite, should not evict 'b'

      expect(cache.get('a')).toBe('blob:a2');
      expect(cache.has('b')).toBe(true);
      expect(revokeObjectURL).not.toHaveBeenCalled();
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
