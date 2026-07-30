import { api } from './api';
import { fetchImageBlob } from './useAuthenticatedImage';
import { createZip } from './zip';
import type { PhotoSummary } from '@photodrop/common/apiTypes';

/**
 * Downloads every photo in the current group into a single zip, with a
 * manifest of captions and uploaders. Photos are fetched one at a time — the
 * bottleneck is the archive living in memory until the download triggers,
 * which is fine at family-group scale (hundreds of photos, not tens of
 * thousands); pacing the fetches keeps the API and the device comfortable.
 */
export async function exportGroupPhotos(
  groupName: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const photos: PhotoSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.photos.list(100, cursor);
    photos.push(...page.photos);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);

  onProgress(0, photos.length);

  const encoder = new TextEncoder();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  const manifest: Array<Record<string, unknown>> = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const blob = await fetchImageBlob(photo.id, 'download');
    const extension = blob.type.includes('png')
      ? 'png'
      : blob.type.includes('webp')
        ? 'webp'
        : 'jpg';
    // Oldest first in filename order, so the archive browses chronologically.
    const ordinal = String(photos.length - i).padStart(4, '0');
    const filename = `photos/${ordinal}-${photo.id}.${extension}`;

    entries.push({ name: filename, data: new Uint8Array(await blob.arrayBuffer()) });
    manifest.push({
      file: filename,
      caption: photo.caption,
      uploadedBy: photo.uploaderName,
      uploadedAt: new Date(photo.uploadedAt * 1000).toISOString(),
    });
    onProgress(i + 1, photos.length);
  }

  entries.push({
    name: 'manifest.json',
    data: encoder.encode(JSON.stringify(manifest.reverse(), null, 2)),
  });

  const zip = createZip(entries);
  const url = URL.createObjectURL(zip);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeName = groupName.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'photodrop';
    anchor.download = `${safeName} photos.zip`;
    anchor.click();
  } finally {
    // Deferred: revoking synchronously can cancel the download in some
    // browsers before it begins.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
