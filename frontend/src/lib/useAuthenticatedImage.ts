import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import { API_BASE_URL } from './api';

// Simple in-memory cache for blob URLs
// Key: `${photoId}:${type}`, Value: blob URL
const imageCache = new Map<string, string>();

// Clear cache on logout/group switch (call from auth context)
export function clearImageCache() {
  imageCache.forEach((url) => URL.revokeObjectURL(url));
  imageCache.clear();
}

interface UseAuthenticatedImageResult {
  src: string | null;
  loading: boolean;
  error: Error | null;
}

export function useAuthenticatedImage(
  photoId: string,
  type: 'thumbnail' | 'download'
): UseAuthenticatedImageResult {
  const [src, setSrc] = useState<string | null>(() => {
    // Check cache on init
    return imageCache.get(`${photoId}:${type}`) || null;
  });
  const [loading, setLoading] = useState(!src);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Use local flag to handle race conditions when photoId/type changes
    let isCurrent = true;
    const cacheKey = `${photoId}:${type}`;

    // Already cached
    if (imageCache.has(cacheKey)) {
      setSrc(imageCache.get(cacheKey)!);
      setLoading(false);
      return;
    }

    // Reset state for new photo/type to avoid stale image flash
    setSrc(null);
    setError(null);
    setLoading(true);

    async function loadImage() {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        if (isCurrent) {
          setError(new Error('No auth token'));
          setLoading(false);
        }
        return;
      }

      const url = `${API_BASE_URL}/photos/${photoId}/${type}`;

      try {
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
          // Use fetch for web
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          blob = await response.blob();
        }

        if (!isCurrent) return;

        const blobUrl = URL.createObjectURL(blob);
        imageCache.set(cacheKey, blobUrl);
        setSrc(blobUrl);
        setError(null);
      } catch (err) {
        if (isCurrent) {
          setError(err as Error);
          console.error(`Failed to load image ${photoId}/${type}:`, err);
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      isCurrent = false;
    };
  }, [photoId, type]);

  return { src, loading, error };
}

// Preload an image into cache without rendering
export async function preloadImage(photoId: string, type: 'thumbnail' | 'download'): Promise<void> {
  const cacheKey = `${photoId}:${type}`;
  if (imageCache.has(cacheKey)) return;

  const token = localStorage.getItem('accessToken');
  if (!token) return;

  const url = `${API_BASE_URL}/photos/${photoId}/${type}`;

  try {
    let blob: Blob;

    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url,
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });

      if (response.status !== 200) return;

      const base64 = response.data as string;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      // Get content-type case-insensitively
      const contentType =
        response.headers['content-type'] || response.headers['Content-Type'] || 'image/jpeg';
      blob = new Blob([bytes], { type: contentType });
    } else {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!response.ok) return;
      blob = await response.blob();
    }

    const blobUrl = URL.createObjectURL(blob);
    imageCache.set(cacheKey, blobUrl);
  } catch {
    // Silently fail for preload
  }
}
