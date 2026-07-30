import { useState, useEffect, useRef, useCallback } from 'react';
import type { PhotoViewersResponse } from '@photodrop/common/apiTypes';
import { api } from '../../lib/api';
import { formatRelativeTime } from '../../lib/dateFormat';

/**
 * Admin-only view receipts for a photo: an eye control that opens a list of
 * who has opened this photo and when. Fed by the views the lightbox records.
 */
export function SeenBy({ photoId }: { photoId: string }) {
  const [open, setOpen] = useState(false);
  const [viewers, setViewers] = useState<PhotoViewersResponse['viewers'] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setLoadFailed(false);
        api.photos
          .getViewers(photoId)
          .then(({ viewers: list }) => setViewers(list))
          .catch(() => setLoadFailed(true));
      }
      return !wasOpen;
    });
  }, [photoId]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close this popover, not the lightbox around it.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (e: Event) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={toggle}
        aria-label="Seen by"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center justify-center w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 border-none cursor-pointer text-white/90 transition-colors"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Seen by"
          className="absolute top-full mt-2 left-0 min-w-48 max-w-72 max-h-[50vh] overflow-y-auto bg-surface border border-border rounded-lg shadow-elevated p-3 text-sm z-[70]"
        >
          {loadFailed ? (
            <p className="text-error" role="alert">
              Couldn't load views
            </p>
          ) : viewers === null ? (
            <p className="text-text-secondary">Loading…</p>
          ) : viewers.length === 0 ? (
            <p className="text-text-secondary">No views yet</p>
          ) : (
            <ul className="space-y-1.5">
              {viewers.map((viewer) => (
                <li key={viewer.userId} className="flex justify-between gap-3">
                  <span className="text-text-primary truncate">{viewer.name}</span>
                  <span className="text-text-muted shrink-0">
                    {formatRelativeTime(viewer.viewedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
