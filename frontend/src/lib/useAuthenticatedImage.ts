import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import { API_BASE_URL } from './api';

// LRU cache for blob URLs with bounded size and proper cleanup
export class LRUImageCache {
  private map = new Map<string, string>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
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
      // Evict oldest (first entry)
      const oldest = this.map.keys().next().value!;
      const oldUrl = this.map.get(oldest)!;
      URL.revokeObjectURL(oldUrl);
      this.map.delete(oldest);
    }
    this.map.set(key, value);
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
const imageCache = new LRUImageCache(200);

// In-flight loads keyed the same way. Without this, concurrent requests for the
// same image (e.g. the rendered <img> and a neighbour preload) each fetch and
// create their own blob URL; the second cache write then revokes the first —
// which may still be in use — causing ERR_FILE_NOT_FOUND. Sharing one promise
// per key guarantees exactly one fetch and one blob URL per image.
const inFlightLoads = new Map<string, Promise<string>>();

// Clear cache on logout/group switch (call from auth context)
export function clearImageCache() {
  imageCache.clear();
  inFlightLoads.clear();
}

type ImageType = 'thumbnail' | 'download';

/** Fetch the image bytes and wrap them in a blob URL. Throws on failure. */
async function fetchImageBlobUrl(photoId: string, type: ImageType): Promise<string> {
  const token = localStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No auth token');
  }

  const url = `${API_BASE_URL}/photos/${photoId}/${type}`;
  let blob: Blob;

  if (Capacitor.isNativePlatform()) {
    // Use CapacitorHttp for native - it handles CORS natively
    const response = await CapacitorHttp.get({
      url,
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    // CapacitorHttp returns base64 string for blob responseType
    const base64 = response.data as string;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // Get content-type case-insensitively (headers may vary)
    const contentType =
      response.headers['content-type'] || response.headers['Content-Type'] || 'image/jpeg';
    blob = new Blob([bytes], { type: contentType });
  } else {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    blob = await response.blob();
  }

  return URL.createObjectURL(blob);
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

  const promise = fetchImageBlobUrl(photoId, type)
    .then((blobUrl) => {
      imageCache.set(cacheKey, blobUrl);
      return blobUrl;
    })
    .finally(() => {
      inFlightLoads.delete(cacheKey);
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
