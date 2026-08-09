import { useState, useEffect } from 'react';
import { API_BASE_URL, refreshAccessToken } from './api';

// Tracks how many mounted consumers are currently displaying each cache key, so
// the LRU never revokes a blob URL that's still bound to an on-screen <img>.
const refCounts = new Map<string, number>();

function acquireImage(key: string): void {
  refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
}

function releaseImage(key: string): void {
  const next = (refCounts.get(key) ?? 0) - 1;
  if (next <= 0) refCounts.delete(key);
  else refCounts.set(key, next);
}

function isInUse(key: string): boolean {
  return (refCounts.get(key) ?? 0) > 0;
}

// LRU cache for blob URLs with bounded size and proper cleanup
export class LRUImageCache {
  private map = new Map<string, string>();
  private readonly maxSize: number;
  private readonly isInUse: (key: string) => boolean;

  constructor(maxSize: number, isInUse: (key: string) => boolean = () => false) {
    this.maxSize = maxSize;
    this.isInUse = isInUse;
  }

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      const oldUrl = this.map.get(key)!;
      URL.revokeObjectURL(oldUrl);
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      this.evictOne();
    }
    this.map.set(key, value);
  }

  // Evict the oldest entry that no mounted consumer is using. If every entry is
  // in use (e.g. a long non-virtualized feed has them all mounted), skip
  // eviction and let the map grow — memory is then bounded by what's actually
  // on screen, and the slack is reclaimed as those consumers unmount. Revoking
  // an in-use URL would break the live <img> with ERR_FILE_NOT_FOUND.
  private evictOne(): void {
    for (const [key, url] of this.map) {
      if (this.isInUse(key)) continue;
      URL.revokeObjectURL(url);
      this.map.delete(key);
      return;
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.forEach((url) => URL.revokeObjectURL(url));
    this.map.clear();
  }
}

// Key: `${photoId}:${type}`, Value: blob URL
const imageCache = new LRUImageCache(200, isInUse);

// In-flight loads keyed the same way. Without this, concurrent requests for the
// same image (e.g. the rendered <img> and a neighbour preload) each fetch and
// create their own blob URL; the second cache write then revokes the first —
// which may still be in use — causing ERR_FILE_NOT_FOUND. Sharing one promise
// per key guarantees exactly one fetch and one blob URL per image. Eviction of
// a still-displayed image is prevented separately by the ref counts above.
const inFlightLoads = new Map<string, Promise<string>>();

// Bumped on every clear so a load that's still in flight when the cache is
// purged (logout/group switch) can detect it resolved into a stale generation
// and drop its result instead of repopulating the cleared cache.
let cacheGeneration = 0;

// Clear cache on logout/group switch (call from auth context)
export function clearImageCache() {
  cacheGeneration += 1;
  imageCache.clear();
  inFlightLoads.clear();
  refCounts.clear();
}

type ImageType = 'thumbnail' | 'download';

interface BlobResult {
  status: number;
  blob: Blob | null;
}

/** Fetch the image bytes for the given token. Returns the status and (on 200) the blob. */
async function fetchBlob(url: string, token: string): Promise<BlobResult> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });

  if (!response.ok) {
    return { status: response.status, blob: null };
  }

  return { status: 200, blob: await response.blob() };
}

/**
 * Fetch the image bytes and wrap them in a blob URL. Throws on failure.
 *
 * Image requests don't go through fetchWithAuth (they need blob handling), so
 * they recover from an expired access token here:
 * on a 401 we run the shared single-flight refresh and retry once, matching the
 * API layer. Without this, an image that 401s during the brief window before a
 * foreground refresh completes would stay broken until the photo remounts.
 */
async function fetchImageBlobUrl(photoId: string, type: ImageType): Promise<string> {
  const url = `${API_BASE_URL}/photos/${photoId}/${type}`;

  let token = localStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No auth token');
  }

  let result = await fetchBlob(url, token);

  if (result.status === 401) {
    const refreshed = await refreshAccessToken();
    token = localStorage.getItem('accessToken');
    if (!refreshed || !token) {
      throw new Error('Session expired');
    }
    result = await fetchBlob(url, token);
  }

  if (result.status !== 200 || !result.blob) {
    throw new Error(`HTTP ${result.status}`);
  }

  return URL.createObjectURL(result.blob);
}

/**
 * Resolve a cached blob URL for the image, loading (and caching) it if needed.
 * Concurrent callers for the same image share a single in-flight fetch.
 */
function loadImage(photoId: string, type: ImageType): Promise<string> {
  const cacheKey = `${photoId}:${type}`;

  const cached = imageCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const pending = inFlightLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const generation = cacheGeneration;
  const promise = fetchImageBlobUrl(photoId, type)
    .then((blobUrl) => {
      if (generation !== cacheGeneration) {
        // The cache was cleared (logout/group switch) while this load was in
        // flight; drop the result rather than caching another session's image.
        URL.revokeObjectURL(blobUrl);
        throw new Error('Image cache cleared during load');
      }
      imageCache.set(cacheKey, blobUrl);
      return blobUrl;
    })
    .finally(() => {
      // Only clear our own entry — a newer load for this key may have replaced
      // it (e.g. after a clear), and we mustn't evict that one.
      if (inFlightLoads.get(cacheKey) === promise) {
        inFlightLoads.delete(cacheKey);
      }
    });

  inFlightLoads.set(cacheKey, promise);
  return promise;
}

interface ImageState {
  key: string;
  src: string | null;
  loading: boolean;
  error: Error | null;
}

function initialImageState(cacheKey: string): ImageState {
  const cached = imageCache.get(cacheKey);
  return { key: cacheKey, src: cached ?? null, loading: !cached, error: null };
}

type UseAuthenticatedImageResult = Omit<ImageState, 'key'>;

export function useAuthenticatedImage(
  photoId: string,
  type: ImageType
): UseAuthenticatedImageResult {
  const cacheKey = `${photoId}:${type}`;
  const [state, setState] = useState<ImageState>(() => initialImageState(cacheKey));

  // When the photo/type changes, sync to the new image during render (showing a
  // cached blob immediately, or resetting to loading) — React's recommended
  // alternative to resetting state inside an effect.
  if (state.key !== cacheKey) {
    setState(initialImageState(cacheKey));
  }

  // Hold a reference to the key we're displaying so the LRU won't evict (and
  // revoke) its blob URL while this <img> is still mounted.
  useEffect(() => {
    acquireImage(cacheKey);
    return () => releaseImage(cacheKey);
  }, [cacheKey]);

  useEffect(() => {
    let isCurrent = true;
    loadImage(photoId, type)
      .then((blobUrl) => {
        if (isCurrent) setState({ key: cacheKey, src: blobUrl, loading: false, error: null });
      })
      .catch((err) => {
        if (!isCurrent) return;
        console.error(`Failed to load image ${photoId}/${type}:`, err);
        setState({ key: cacheKey, src: null, loading: false, error: err as Error });
      });

    return () => {
      isCurrent = false;
    };
  }, [photoId, type, cacheKey]);

  return { src: state.src, loading: state.loading, error: state.error };
}

// Preload an image into cache without rendering
export async function preloadImage(photoId: string, type: ImageType): Promise<void> {
  try {
    await loadImage(photoId, type);
  } catch {
    // Silently fail for preload
  }
}
