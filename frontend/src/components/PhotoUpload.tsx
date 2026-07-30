import { useState, useRef, useEffect, useCallback } from 'react';
import { CAPTION_MAX_LENGTH } from '@photodrop/common/limits';
import { api } from '../lib/api';
import {
  compressImage,
  convertHeicToJpeg,
  isHeicFile,
  validateImageFile,
  validateImageDecodes,
  formatFileSize,
} from '../lib/imageCompression';
import { Button } from './Button';

// Only start showing the character counter near the limit, so it doesn't
// nag over a normal-length caption.
const CAPTION_COUNTER_THRESHOLD = CAPTION_MAX_LENGTH - 100;

// Parallel uploads per batch. Compression holds decoded bitmaps in memory,
// so unbounded parallelism would sink low-memory phones on a big batch.
const CONCURRENT_UPLOADS = 3;

type QueueItemStatus =
  | 'processing' // validating / HEIC conversion / preview generation
  | 'invalid' // rejected at selection time; never uploadable
  | 'ready'
  | 'compressing'
  | 'uploading'
  | 'done'
  | 'failed'; // upload failed; retryable

interface QueueItem {
  id: string;
  sourceName: string;
  size: number;
  /** Processed (post-HEIC-conversion) file; null until processing succeeds. */
  file: File | null;
  preview: string | null;
  caption: string;
  status: QueueItemStatus;
  error: string | null;
  /** Upload progress fraction 0..1, meaningful while status is 'uploading'. */
  progress: number;
}

interface PhotoUploadProps {
  onUploadComplete?: (uploadedCount: number) => void;
  isModal?: boolean;
  /** Files handed in from outside the picker, e.g. dropped onto the feed. */
  initialFiles?: File[];
}

let nextItemId = 0;

export function PhotoUpload({ onUploadComplete, isModal = false, initialFiles }: PhotoUploadProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [batchUploading, setBatchUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `items`, written ONLY by the mutation helpers below (never in
  // render): the queue runner and completion checks read it synchronously
  // between mutations, before React commits — a render-phase writer whose
  // `items` snapshot predated a mutation would roll the mirror back.
  const itemsRef = useRef<QueueItem[]>([]);
  // Guards state updates from async pipelines of items that were removed.
  const removedIdsRef = useRef(new Set<string>());

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    if (removedIdsRef.current.has(id)) return;
    // The mirror updates synchronously: the queue runner checks completion the
    // moment its last upload settles, before React has committed the state.
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const accepted: Array<{ id: string; file: File }> = [];
      const newItems: QueueItem[] = [];

      for (const file of files) {
        const id = `upload-${nextItemId++}`;
        const base: QueueItem = {
          id,
          sourceName: file.name,
          size: file.size,
          file: null,
          preview: null,
          caption: '',
          status: 'processing',
          error: null,
          progress: 0,
        };
        const validation = validateImageFile(file);
        if (!validation.valid) {
          newItems.push({ ...base, status: 'invalid', error: validation.error ?? 'Invalid file' });
          continue;
        }
        newItems.push(base);
        accepted.push({ id, file });
      }

      if (newItems.length > 0) {
        itemsRef.current = [...itemsRef.current, ...newItems];
        setItems((prev) => [...prev, ...newItems]);
      }

      for (const { id, file } of accepted) {
        void (async () => {
          let processedFile = file;
          if (isHeicFile(file)) {
            try {
              processedFile = await convertHeicToJpeg(file);
            } catch (err) {
              console.error('HEIC conversion failed:', err);
              updateItem(id, {
                status: 'invalid',
                error: 'Could not process HEIC file. Please try a different image.',
              });
              return;
            }
          }

          // Decode the bytes before accepting the file: anything that fails
          // here can never upload, and a specific selection-time error beats
          // a broken preview followed by a generic failure at upload time.
          const decodes = await validateImageDecodes(processedFile);
          if (!decodes) {
            updateItem(id, {
              status: 'invalid',
              error: "This file doesn't appear to be a valid image.",
            });
            return;
          }

          const preview = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target?.result as string) ?? null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(processedFile);
          });

          updateItem(id, { status: 'ready', file: processedFile, preview });
        })();
      }
    },
    [updateItem]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Selecting the same file again must re-fire change.
    e.target.value = '';
  };

  const removeItem = (id: string) => {
    removedIdsRef.current.add(id);
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id);
    setItems((prev) => prev.filter((item) => item.id !== id));
    maybeComplete();
  };

  // Files handed in from a feed-level drop are queued exactly once on mount.
  const initialFilesRef = useRef(initialFiles);
  useEffect(() => {
    if (initialFilesRef.current && initialFilesRef.current.length > 0) {
      addFiles(initialFilesRef.current);
      initialFilesRef.current = undefined;
    }
  }, [addFiles]);

  // Paste-from-clipboard while the uploader is on screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        addFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const uploadOne = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || !item.file) return false;

      try {
        updateItem(id, { status: 'compressing', error: null, progress: 0 });
        const { fullSize, thumbnail } = await compressImage(item.file);
        updateItem(id, { status: 'uploading' });
        await api.photos.upload(fullSize, thumbnail, item.caption || undefined, (fraction) =>
          updateItem(id, { progress: fraction })
        );
        updateItem(id, { status: 'done', progress: 1 });
        return true;
      } catch (err) {
        updateItem(id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
        return false;
      }
    },
    [updateItem]
  );

  /**
   * Fires the batch-complete callback when nothing actionable remains and at
   * least one photo landed. Consulted when a run drains and when an item is
   * removed — deleting the one failed row must not leave the modal in limbo
   * with uploaded photos the feed doesn't know about.
   */
  const maybeComplete = useCallback(() => {
    const doneCount = itemsRef.current.filter((i) => i.status === 'done').length;
    const remaining = itemsRef.current.filter(
      (i) => i.status !== 'done' && i.status !== 'invalid'
    );
    if (doneCount > 0 && remaining.length === 0) {
      onUploadComplete?.(doneCount);
    }
  }, [onUploadComplete]);

  const runQueue = useCallback(
    async (ids: string[]) => {
      setBatchUploading(true);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENT_UPLOADS, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          await uploadOne(id);
        }
      });
      await Promise.all(workers);
      setBatchUploading(false);
      maybeComplete();
    },
    [uploadOne, maybeComplete]
  );

  const handleUploadAll = () => {
    const ids = items.filter((i) => i.status === 'ready' || i.status === 'failed').map((i) => i.id);
    if (ids.length > 0) void runQueue(ids);
  };

  const handleRetry = (id: string) => void runQueue([id]);

  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const processingCount = items.filter((i) => i.status === 'processing').length;

  const statusLine = (item: QueueItem): string | null => {
    switch (item.status) {
      case 'processing':
        return 'Preparing…';
      case 'compressing':
        return 'Compressing…';
      case 'uploading':
        return `Uploading… ${Math.round(item.progress * 100)}%`;
      case 'done':
        return 'Uploaded';
      default:
        return null;
    }
  };

  const uploadContent = (
    <div className="space-y-4">
      {!isModal && <h2 className="text-lg font-medium text-text-primary">Upload photos</h2>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
          }
        }}
        className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
          dragActive ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        <input
          id="photo-input"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          disabled={batchUploading}
          className="file-input"
          aria-label="Choose photos"
        />
        <p className="text-xs text-text-muted mt-2">
          Select several at once, drag photos here, or paste from the clipboard.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-3" aria-label="Upload queue">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 items-start">
              <div className="w-16 h-16 shrink-0 rounded-md bg-bg-secondary overflow-hidden flex items-center justify-center">
                {item.preview ? (
                  <img src={item.preview} alt="" className="w-full h-full object-cover" />
                ) : item.status === 'processing' ? (
                  <div className="w-full h-full animate-pulse bg-bg-secondary" />
                ) : (
                  <span aria-hidden="true" className="text-text-muted text-lg">
                    !
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm text-text-secondary truncate">
                  {item.sourceName} ({formatFileSize(item.size)})
                </p>

                {item.status === 'invalid' || item.status === 'failed' ? (
                  <p className="text-sm text-error" role="alert">
                    {item.error}
                  </p>
                ) : (
                  <>
                    {(item.status === 'ready' ||
                      item.status === 'compressing' ||
                      item.status === 'uploading') && (
                      <div>
                        <input
                          type="text"
                          value={item.caption}
                          onChange={(e) => updateItem(item.id, { caption: e.target.value })}
                          disabled={item.status !== 'ready'}
                          maxLength={CAPTION_MAX_LENGTH}
                          placeholder="Add a caption…"
                          aria-label={`Caption for ${item.sourceName}`}
                          className="input-field text-sm py-1.5"
                        />
                        {Array.from(item.caption).length > CAPTION_COUNTER_THRESHOLD && (
                          <p className="text-xs text-text-muted mt-1">
                            {Array.from(item.caption).length}/{CAPTION_MAX_LENGTH}
                          </p>
                        )}
                      </div>
                    )}
                    {statusLine(item) && (
                      <p className="text-sm text-text-secondary" aria-live="polite">
                        {statusLine(item)}
                      </p>
                    )}
                    {item.status === 'uploading' && (
                      <div className="h-1.5 rounded-full bg-bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-accent-solid transition-[width]"
                          style={{ width: `${Math.round(item.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-col gap-1 items-end shrink-0">
                {item.status === 'failed' && (
                  <Button size="sm" variant="secondary" onClick={() => handleRetry(item.id)}>
                    Retry
                  </Button>
                )}
                {item.status !== 'uploading' && item.status !== 'compressing' && (
                  <button
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.sourceName}`}
                    className="w-8 h-8 rounded-full hover:bg-bg-secondary flex items-center justify-center text-text-secondary cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <Button
          onClick={handleUploadAll}
          size="lg"
          disabled={batchUploading || processingCount > 0 || readyCount === 0}
          className="w-full"
        >
          {batchUploading ? (
            <span className="flex items-center gap-2">
              <span className="spinner spinner-sm" />
              Uploading…
            </span>
          ) : readyCount > 1 ? (
            `Upload ${readyCount} photos`
          ) : (
            'Upload'
          )}
        </Button>
      )}
    </div>
  );

  if (isModal) {
    return uploadContent;
  }

  return (
    <div className="max-w-[480px] mx-auto">
      <div className="card">{uploadContent}</div>
    </div>
  );
}
