import { strToU8, Zip, ZipPassThrough } from 'fflate';
import { api, ApiError } from './api';

export interface GroupExportProgress {
  completed: number;
  total: number;
}

/**
 * Cancelling is a normal outcome rather than a failure, so it is reported in
 * the return type. Callers get a total they must handle explicitly, instead of
 * having to sniff an error's name to tell "the user stopped it" from "it broke".
 */
export type GroupExportOutcome = { status: 'downloaded' } | { status: 'cancelled' };

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

function waitBeforeRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 500 * attempt);

    // Without this the backoff would swallow a cancellation for up to a
    // second, so the export keeps running after the user has stopped it.
    function onAbort() {
      window.clearTimeout(timer);
      reject(signal!.reason);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function downloadPhoto(
  photo: { id: string; fileName: string },
  position: number,
  total: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const blob = await api.photos.downloadBlob(photo.id, signal);
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      lastError = error;
      // An aborted fetch rejects with something isRetryable treats as
      // transient, so without this a cancelled export would retry twice more
      // before giving up.
      signal?.throwIfAborted();
      if (attempt === maxAttempts || !isRetryable(error)) break;
      await waitBeforeRetry(attempt, signal);
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

async function runExport(
  groupId: string,
  onProgress: ((progress: GroupExportProgress) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const manifest = await api.groups.getExport(groupId, signal);
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
      signal?.throwIfAborted();
      const photo = manifest.photos[index];
      const bytes = await downloadPhoto(photo, index + 1, manifest.photos.length, signal);
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
  // Cancelling while the ZIP finalises must not still land a file in the
  // user's downloads folder.
  signal?.throwIfAborted();

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(manifest.groupName)}-photodrop-export.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download converted archive photos into an incrementally generated,
 * uncompressed ZIP. Aborting `signal` stops the export at the next photo
 * boundary and discards the partial archive.
 */
export async function exportGroup(
  groupId: string,
  onProgress?: (progress: GroupExportProgress) => void,
  signal?: AbortSignal
): Promise<GroupExportOutcome> {
  try {
    await runExport(groupId, onProgress, signal);
    return { status: 'downloaded' };
  } catch (error) {
    // Aborts surface from several places — the manifest fetch, a photo
    // download, the retry backoff, the explicit checks — and as different
    // error shapes depending on which. The signal itself is the reliable
    // witness that the user cancelled rather than something breaking.
    if (signal?.aborted) return { status: 'cancelled' };
    throw error;
  }
}
