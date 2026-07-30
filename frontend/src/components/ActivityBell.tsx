import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityResponse } from '@photodrop/common/apiTypes';
import { api } from '../lib/api';
import { coalesceActivity } from '../lib/activity';
import { formatRelativeTime } from '../lib/dateFormat';

// Keep the badge honest while the tab sits open.
const ACTIVITY_POLL_INTERVAL_MS = 60_000;

/**
 * The header bell: the group's activity inbox. Shows an unread badge, and a
 * panel of coalesced activity rows deep-linking into the lightbox. Opening
 * the panel marks everything seen (badge clears); rows keep their unread
 * highlight until the panel closes, judged against the pre-open baseline.
 */
export function ActivityBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ActivityResponse | null>(null);
  // seenAt as it stood when the panel was opened — the highlight baseline.
  const [openBaseline, setOpenBaseline] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const refetch = useCallback(async () => {
    try {
      setData(await api.activity.list());
    } catch {
      // Transient; the next poll or open retries.
    }
  }, []);

  useEffect(() => {
    void refetch();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch();
    }, ACTIVITY_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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

  const rows = data ? coalesceActivity(data.events, data.seenAt) : [];
  const unreadCount = rows.filter((r) => r.unread).length;
  const panelRows = data ? coalesceActivity(data.events, openBaseline) : [];

  const handleToggle = () => {
    if (!open) {
      setOpenBaseline(data?.seenAt ?? 0);
      setOpen(true);
      void refetch();
      // Opening the panel is what "seen" means; the badge clears, the rows
      // keep their highlight against the pre-open baseline until close.
      api.activity
        .markSeen()
        .then(({ seenAt }) => setData((prev) => (prev ? { ...prev, seenAt } : prev)))
        .catch(() => {
          // The badge simply stays until a later open succeeds.
        });
    } else {
      setOpen(false);
    }
  };

  const openRow = (photoId: string | undefined, openComments: boolean | undefined) => {
    setOpen(false);
    if (photoId) {
      navigate(`/photo/${photoId}${openComments ? '?comments=open' : ''}`);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `Activity (${unreadCount} unread)` : 'Activity'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-transparent cursor-pointer transition-colors hover:bg-bg-secondary text-text-secondary"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-solid text-white text-[10px] font-semibold flex items-center justify-center"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Activity"
          className="absolute top-[calc(100%+0.5rem)] right-0 w-[320px] max-w-[85vw] max-h-[60vh] overflow-y-auto bg-surface border border-border rounded-lg shadow-elevated z-50"
        >
          {panelRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted text-center">
              Nothing new — you're all caught up
            </p>
          ) : (
            <ul className="py-1">
              {panelRows.map((row) => (
                <li key={row.key}>
                  <button
                    onClick={() => openRow(row.photoId, row.openComments)}
                    disabled={!row.photoId}
                    className={`w-full text-left px-4 py-2.5 border-none bg-transparent transition-colors text-sm ${
                      row.photoId ? 'cursor-pointer hover:bg-bg-tertiary' : 'cursor-default'
                    } ${row.unread ? 'text-text-primary' : 'text-text-secondary'}`}
                  >
                    <span className="flex items-start gap-2">
                      {row.unread && (
                        <span
                          className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-accent-solid"
                          aria-label="Unread"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block break-words">{row.label}</span>
                        <span className="block text-xs text-text-muted mt-0.5">
                          {formatRelativeTime(row.at)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
