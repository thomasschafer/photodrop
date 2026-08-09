import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useAuthenticatedImage,
  preloadImage,
  clearImageCache,
  LRUImageCache,
} from './useAuthenticatedImage';

// Declare global for Node.js environment in tests
declare const global: typeof globalThis;

// Keep the real api module (for API_BASE_URL) but stub the refresh so we can
// drive the image hook's 401-recovery path deterministically.
vi.mock('./api', async (importActual) => {
  const actual = await importActual<typeof import('./api')>();
  return { ...actual, refreshAccessToken: vi.fn() };
});

// Import mocked modules
import { refreshAccessToken } from './api';

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

    // Setup fetch mock
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

  describe('image fetching', () => {
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

    it('refreshes the token and retries once on a 401, then succeeds', async () => {
      // Token expired mid-session: the first fetch 401s, we refresh (shared
      // single-flight) and the retry succeeds. Image requests don't go through
      // fetchWithAuth, so this recovery lives in the hook.
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(mockBlob) });
      vi.mocked(refreshAccessToken).mockResolvedValue(true);

      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.current.src).toBe('blob:test-url');
      expect(result.current.error).toBeNull();
    });

    it('errors without retrying the fetch when the refresh fails', async () => {
      // A genuinely dead session: refresh returns false, so we surface the error
      // (AuthContext's session-expired handler routes to login) and don't loop.
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.mocked(refreshAccessToken).mockResolvedValue(false);

      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'thumbnail'));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
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

    it('dedupes concurrent loads of the same image (no double fetch or revoke)', async () => {
      // The lightbox renders an image and preloads the same neighbour at the
      // same time. Both must share one fetch + one blob URL — otherwise the
      // second cache write revokes the first, still-displayed blob, producing
      // ERR_FILE_NOT_FOUND when navigating.
      const { result } = renderHook(() => useAuthenticatedImage(mockPhotoId, 'download'));
      // Kick off a concurrent preload for the same image while the first load
      // is still in flight.
      const preload = preloadImage(mockPhotoId, 'download');

      await waitFor(() => expect(result.current.loading).toBe(false));
      await preload;

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(result.current.src).toBe('blob:test-url');
      expect(result.current.error).toBeNull();
    });
  });

  describe('LRUImageCache', () => {
    let revokeObjectURL: (url: string) => void;

    beforeEach(() => {
      revokeObjectURL = vi.fn() as unknown as (url: string) => void;
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

    it('skips an in-use entry during eviction and revokes the oldest free one', () => {
      const inUse = new Set<string>(['a']);
      const cache = new LRUImageCache(2, (k) => inUse.has(k));
      cache.set('a', 'blob:a'); // oldest, but stays mounted (in use)
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c'); // over capacity: skip 'a', evict 'b'

      expect(cache.has('a')).toBe(true);
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:a');
      expect(cache.has('b')).toBe(false);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:b');
      expect(cache.has('c')).toBe(true);
    });

    it('grows beyond maxSize rather than revoking when every entry is in use', () => {
      const inUse = new Set<string>(['a', 'b']);
      const cache = new LRUImageCache(2, (k) => inUse.has(k));
      cache.set('a', 'blob:a');
      cache.set('b', 'blob:b');
      cache.set('c', 'blob:c'); // both in use: nothing safe to evict

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('overwrites existing key without eviction', () => {
      const cache = new LRUImageCache(2);
      cache.set('a', 'blob:a1');
      cache.set('b', 'blob:b');
      cache.set('a', 'blob:a2'); // overwrite, should not evict 'b'

      expect(cache.get('a')).toBe('blob:a2');
      expect(cache.has('b')).toBe(true);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:a1');
    });
  });

  describe('clearImageCache', () => {
    it('drops an in-flight load that resolves after a clear (no stale repopulation)', async () => {
      // Logout/group-switch clears the cache. A load already in flight must not
      // reinsert the old session's image when it resolves afterwards.
      let resolveFetch!: (value: { ok: true; blob: () => Promise<Blob> }) => void;
      const pending = new Promise<{ ok: true; blob: () => Promise<Blob> }>((resolve) => {
        resolveFetch = resolve;
      });
      global.fetch = vi.fn(() => pending) as unknown as typeof fetch;

      const { result } = renderHook(() => useAuthenticatedImage('photo-stale', 'thumbnail'));
      expect(result.current.loading).toBe(true);

      // Purge while the fetch is still pending, then let it resolve.
      clearImageCache();
      await act(async () => {
        resolveFetch!({ ok: true, blob: () => Promise.resolve(mockBlob) });
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      // The late result is dropped: the orphan blob URL is revoked and nothing
      // is cached for the stale key.
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
      expect(result.current.src).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

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
