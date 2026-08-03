import { strToU8, Zip, ZipPassThrough } from 'fflate';
import { api, ApiError } from './api';

export interface GroupExportProgress {
  completed: number;
  total: number;
}

function safeFileName(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'photodrop-export';
}

function isRetryable(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 500 * attempt));
}

async function downloadPhoto(
  photo: { id: string; fileName: string },
  position: number,
  total: number
): Promise<Uint8Array> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const blob = await api.photos.downloadBlob(photo.id);
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) break;
      await waitBeforeRetry(attempt);
    }
  }

  const reason = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(
    `Could not download ${photo.fileName} (${photo.id}), photo ${position} of ${total}${reason}`
  );
}

function addStoredFile(zip: Zip, name: string, bytes: Uint8Array): void {
  const file = new ZipPassThrough(name);
  zip.add(file);
  file.push(bytes, true);
}

/** Download converted archive photos into an incrementally generated, uncompressed ZIP. */
export async function exportGroup(
  groupId: string,
  onProgress?: (progress: GroupExportProgress) => void
): Promise<void> {
  const manifest = await api.groups.getExport(groupId);
  const chunks: BlobPart[] = [];
  let settleZip!: (blob: Blob) => void;
  let rejectZip!: (error: Error) => void;
  const completedZip = new Promise<Blob>((resolve, reject) => {
    settleZip = resolve;
    rejectZip = reject;
  });
  // The callback can reject before execution reaches the await below. Attach
  // a handler immediately so a simultaneous synchronous ZIP error cannot leave
  // an orphaned browser-level unhandled rejection; awaiting the original
  // promise still propagates that error to the caller.
  void completedZip.catch(() => {});
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectZip(error);
      return;
    }
    if (chunk.length > 0) chunks.push(chunk as BlobPart);
    if (final) settleZip(new Blob(chunks, { type: 'application/zip' }));
  });

  try {
    for (let index = 0; index < manifest.photos.length; index += 1) {
      const photo = manifest.photos[index];
      const bytes = await downloadPhoto(photo, index + 1, manifest.photos.length);
      addStoredFile(zip, `photos/${photo.fileName}`, bytes);
      onProgress?.({ completed: index + 1, total: manifest.photos.length });
    }
    addStoredFile(zip, 'metadata.json', strToU8(JSON.stringify(manifest, null, 2)));
    zip.end();
  } catch (error) {
    zip.terminate();
    throw error;
  }

  const blob = await completedZip;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(manifest.groupName)}-photodrop-export.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
