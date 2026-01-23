import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE_URL } from '../lib/api';
import { formatRelativeTime } from '../lib/dateFormat';
import { useFocusRestore } from '../lib/hooks';
import { getNavDirection, isHorizontalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';
import { useIsPortrait } from '../lib/useIsPortrait';
import { useVirtualCarousel } from '../lib/useVirtualCarousel';
import { ConfirmModal } from './ConfirmModal';
import { SelectDropdown } from './SelectDropdown';
import { Modal } from './Modal';
import { PhotoUpload } from './PhotoUpload';
import { useAuth } from '../contexts/AuthContext';

function getAuthToken(): string {
  return localStorage.getItem('accessToken') || '';
}

interface ReactionSummary {
  emoji: string;
  count: number;
}

interface Photo {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
  reactionCount: number;
  commentCount: number;
  reactions: ReactionSummary[];
  userReaction: string | null;
}

const EMOJI_OPTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
const LONG_PRESS_TIMEOUT_MS = 500;

interface PhotoFeedProps {
  isAdmin?: boolean;
}

interface ReactionPillsProps {
  reactions: ReactionSummary[];
  userReaction: string | null;
  onReactionClick: (emoji: string) => void;
  onAddClick: () => void;
  showPicker: boolean;
  pickerRef?: React.RefObject<HTMLDivElement | null>;
  triggerRef?: React.RefCallback<HTMLButtonElement | null>;
  optionRefs?: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onPickerBlur?: (e: React.FocusEvent) => void;
  onTriggerKeyDown?: (e: React.KeyboardEvent) => void;
  onOptionKeyDown?: (e: React.KeyboardEvent, index: number) => void;
  onPickerSelect?: (emoji: string) => void;
  pickerPosition?: 'above' | 'below';
  useViewportPositioning?: boolean;
  reactionDetails?: ReactionWithUser[];
  onLoadReactionDetails?: () => void;
  currentUserId?: string;
  showNames?: boolean;
}

interface ReactionPillButtonProps {
  emoji: string;
  count: number;
  isUserReaction: boolean;
  names: string[] | undefined;
  pillBaseClass: string;
  onClick: () => void;
  onLoadDetails: () => void;
  showTooltip: boolean;
  onShowTooltip: () => void;
  enableLongPress: boolean;
}

function ReactionPillButton({
  emoji,
  count,
  isUserReaction,
  names,
  pillBaseClass,
  onClick,
  onLoadDetails,
  showTooltip,
  onShowTooltip,
  enableLongPress,
}: ReactionPillButtonProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enableLongPress) return;
      longPressedRef.current = false;
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        onLoadDetails();
        onShowTooltip();
      }, LONG_PRESS_TIMEOUT_MS);
    },
    [enableLongPress, onLoadDetails, onShowTooltip]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startPosRef.current) return;
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
    const deltaY = Math.abs(touch.clientY - startPosRef.current.y);
    if (deltaX > 10 || deltaY > 10) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      startPosRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (longPressedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressedRef.current = false;
        return;
      }
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  return (
    <div className="relative group">
      <button
        onTouchStart={enableLongPress ? handleTouchStart : undefined}
        onTouchMove={enableLongPress ? handleTouchMove : undefined}
        onTouchEnd={enableLongPress ? handleTouchEnd : undefined}
        onClick={handleClick}
        className={`${pillBaseClass} px-2.5 gap-1 ${
          isUserReaction
            ? 'bg-accent/25 hover:bg-accent/35'
            : 'bg-bg-tertiary hover:bg-bg-border'
        }`}
        aria-label={`${isUserReaction ? 'Remove' : 'Add'} ${emoji} reaction`}
        aria-pressed={isUserReaction}
      >
        <span>{emoji}</span>
        <span className="text-text-primary font-medium">{count}</span>
      </button>
      {names && names.length > 0 && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2.5 px-2.5 py-1.5 bg-surface border border-border rounded-lg shadow-elevated text-sm text-text-secondary whitespace-nowrap transition-opacity pointer-events-none z-[70] ${
            showTooltip ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {names.join(', ')}
        </div>
      )}
    </div>
  );
}

function ReactionPills({
  reactions,
  userReaction,
  onReactionClick,
  onAddClick,
  showPicker,
  pickerRef,
  triggerRef,
  optionRefs,
  onPickerBlur,
  onTriggerKeyDown,
  onOptionKeyDown,
  onPickerSelect,
  pickerPosition = 'below',
  useViewportPositioning = false,
  reactionDetails,
  onLoadReactionDetails,
  currentUserId,
  showNames = false,
}: ReactionPillsProps) {
  const hasLoadedRef = useRef(false);
  const [longPressTooltipEmoji, setLongPressTooltipEmoji] = useState<string | null>(null);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const internalPickerRef = useRef<HTMLDivElement | null>(null);
  const [, setResizeCounter] = useState(0);

  // Memoized ref callback to avoid creating new function each render
  const setTriggerRef = useCallback(
    (el: HTMLButtonElement | null) => {
      internalTriggerRef.current = el;
      triggerRef?.(el);
    },
    [triggerRef]
  );

  // Recalculate position on resize/orientation change while picker is open
  useEffect(() => {
    if (!showPicker || !useViewportPositioning) return;

    const handleResize = () => setResizeCounter((c) => c + 1);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [showPicker, useViewportPositioning]);

  // Calculate picker position synchronously, clamping to viewport
  const getPickerStyle = (): React.CSSProperties | undefined => {
    if (!useViewportPositioning || !internalTriggerRef.current) return undefined;

    const button = internalTriggerRef.current;
    const rect = button.getBoundingClientRect();
    // Use measured width if available, otherwise estimate
    const pickerWidth = internalPickerRef.current?.offsetWidth ?? 280;
    const padding = 8;
    const viewportWidth = window.innerWidth;

    // Center picker on button, then clamp to viewport
    let left = rect.left + rect.width / 2 - pickerWidth / 2;
    left = Math.max(padding, Math.min(left, viewportWidth - pickerWidth - padding));

    const style: React.CSSProperties = {
      position: 'fixed',
      left: `${left}px`,
    };

    if (pickerPosition === 'above') {
      style.bottom = `${window.innerHeight - rect.top + 8}px`;
    } else {
      style.top = `${rect.bottom + 8}px`;
    }

    return style;
  };

  // Dismiss tooltip on any interaction elsewhere
  useEffect(() => {
    if (!longPressTooltipEmoji) return;

    const dismiss = () => setLongPressTooltipEmoji(null);

    document.addEventListener('touchstart', dismiss);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('scroll', dismiss, true);

    return () => {
      document.removeEventListener('touchstart', dismiss);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [longPressTooltipEmoji]);

  const pillBaseClass =
    'h-9 rounded-full flex items-center justify-center text-sm transition-colors cursor-pointer select-none';

  // Compute reactions and reactionsByEmoji from reactionDetails if available
  const { computedReactions, reactionsByEmoji } = useMemo(() => {
    if (!reactionDetails || reactionDetails.length === 0) {
      return { computedReactions: undefined, reactionsByEmoji: undefined };
    }

    const grouped: Record<string, string[]> = {};
    const counts: Record<string, number> = {};

    for (const r of reactionDetails) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      if (!counts[r.emoji]) counts[r.emoji] = 0;

      const name = currentUserId && r.userId === currentUserId ? 'You' : r.userName;
      grouped[r.emoji].push(name);
      counts[r.emoji]++;
    }

    const computedReactions: ReactionSummary[] = Object.entries(counts)
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

    return { computedReactions, reactionsByEmoji: grouped };
  }, [reactionDetails, currentUserId]);

  // Use computed reactions from details if available, otherwise fall back to prop (sorted for consistency)
  const sortedReactionsFallback = useMemo(
    () => [...reactions].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
    [reactions]
  );
  const displayReactions = computedReactions ?? sortedReactionsFallback;

  const handleMouseEnter = () => {
    if (showNames && !hasLoadedRef.current && onLoadReactionDetails) {
      hasLoadedRef.current = true;
      onLoadReactionDetails();
    }
  };

  return (
    <div
      className="flex gap-1.5 flex-wrap items-center relative"
      ref={showPicker ? pickerRef : undefined}
      onBlur={showPicker ? onPickerBlur : undefined}
      onMouseEnter={handleMouseEnter}
    >
      {displayReactions.map(({ emoji, count }) => {
        const isUserReaction = userReaction === emoji;
        const names = showNames ? reactionsByEmoji?.[emoji] : undefined;
        return (
          <ReactionPillButton
            key={emoji}
            emoji={emoji}
            count={count}
            isUserReaction={isUserReaction}
            names={names}
            pillBaseClass={pillBaseClass}
            onClick={() => onReactionClick(emoji)}
            onLoadDetails={handleMouseEnter}
            showTooltip={showNames && longPressTooltipEmoji === emoji}
            onShowTooltip={() => setLongPressTooltipEmoji(emoji)}
            enableLongPress={showNames}
          />
        );
      })}

      {/* Add reaction button */}
      <div className="relative">
        <button
          ref={setTriggerRef}
          onClick={(e) => {
            e.stopPropagation();
            onAddClick();
          }}
          onKeyDown={onTriggerKeyDown}
          className={`${pillBaseClass} w-9 ${
            showPicker
              ? 'bg-bg-tertiary text-text-primary'
              : 'bg-bg-tertiary hover:bg-bg-border text-text-secondary'
          }`}
          aria-label="Add reaction"
          aria-expanded={showPicker}
          aria-haspopup="listbox"
        >
          +
        </button>

        {/* Reaction picker dropdown */}
        {showPicker && (
          <div
            ref={(el) => {
              internalPickerRef.current = el;
              if (pickerRef && 'current' in pickerRef) {
                (pickerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              }
            }}
            role="listbox"
            aria-label="Select reaction"
            className={`z-[60] bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1 ${
              useViewportPositioning
                ? ''
                : `absolute right-0 ${pickerPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`
            }`}
            style={getPickerStyle()}
          >
            {EMOJI_OPTIONS.map((emoji, index) => (
              <button
                key={emoji}
                ref={(el) => {
                  if (optionRefs) {
                    optionRefs.current[index] = el;
                  }
                }}
                role="option"
                aria-selected={userReaction === emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onPickerSelect) {
                    onPickerSelect(emoji);
                  } else {
                    onReactionClick(emoji);
                  }
                }}
                onKeyDown={(e) => onOptionKeyDown?.(e, index)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors cursor-pointer ${
                  userReaction === emoji
                    ? 'bg-accent/25 hover:bg-accent/35'
                    : 'hover:bg-bg-tertiary'
                }`}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ReactionWithUser {
  emoji: string;
  userId: string;
  userName: string;
}

export function PhotoFeed({ isAdmin = false }: PhotoFeedProps) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [feedReactionPickerPhotoId, setFeedReactionPickerPhotoId] = useState<string | null>(null);
  const [feedReactionDetails, setFeedReactionDetails] = useState<Map<string, ReactionWithUser[]>>(
    new Map()
  );
  const token = getAuthToken();
  const [uploadButtonRef, restoreUploadFocus] = useFocusRestore<HTMLButtonElement>();
  const deleteButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const photoRefs = useRef<(HTMLElement | null)[]>([]);
  const feedReactionPickerRef = useRef<HTMLDivElement>(null);
  const feedReactionTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const feedReactionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();
  const { photoId } = useParams<{ photoId: string }>();

  const loadFeedReactionDetails = useCallback(
    async (photoId: string) => {
      if (feedReactionDetails.has(photoId)) return;

      try {
        const data = await api.photos.getReactions(photoId);
        setFeedReactionDetails((prev) => new Map(prev).set(photoId, data.reactions));
      } catch (err) {
        console.error('Failed to load reaction details:', err);
      }
    },
    [feedReactionDetails]
  );

  // Close feed reaction picker on click outside or escape
  useEffect(() => {
    if (!feedReactionPickerPhotoId) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        feedReactionPickerRef.current &&
        !feedReactionPickerRef.current.contains(e.target as Node)
      ) {
        setFeedReactionPickerPhotoId(null);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFeedReactionPickerPhotoId(null);
        feedReactionTriggerRefs.current.get(feedReactionPickerPhotoId)?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [feedReactionPickerPhotoId]);

  // Focus first option when feed reaction picker opens
  useEffect(() => {
    if (feedReactionPickerPhotoId) {
      const photo = photos.find((p) => p.id === feedReactionPickerPhotoId);
      const currentIndex = photo?.userReaction ? EMOJI_OPTIONS.indexOf(photo.userReaction) : 0;
      feedReactionOptionRefs.current[currentIndex >= 0 ? currentIndex : 0]?.focus();
    }
  }, [feedReactionPickerPhotoId, photos]);

  const selectedPhotoIndex = photoId ? photos.findIndex((p) => p.id === photoId) : null;
  const selectedPhoto =
    selectedPhotoIndex !== null && selectedPhotoIndex >= 0 ? photos[selectedPhotoIndex] : null;

  const loadPhotos = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.photos.list(20, 0);
      setPhotos(data.photos);
      setFeedReactionDetails(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, []);

  useEffect(() => {
    if (!loading && photoId && photos.length > 0 && selectedPhotoIndex === -1) {
      navigate('/', { replace: true });
    }
  }, [loading, photoId, photos.length, selectedPhotoIndex, navigate]);

  const focusPhoto = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, photos.length - 1));
      photoRefs.current[clampedIndex]?.focus();
    },
    [photos.length]
  );

  const handlePhotoKeyDown = (e: React.KeyboardEvent, index: number) => {
    const direction = getNavDirection(e);
    if (direction === 'down') {
      e.preventDefault();
      focusPhoto(index + 1);
    } else if (direction === 'up') {
      e.preventDefault();
      focusPhoto(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusPhoto(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusPhoto(photos.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        navigate(`/photo/${photos[index].id}`);
      }
    }
  };

  const handleLightboxClose = useCallback(() => {
    const indexToFocus = selectedPhotoIndex;
    navigate('/');
    if (indexToFocus !== null && indexToFocus >= 0) {
      setTimeout(() => focusPhoto(indexToFocus), 0);
    }
  }, [selectedPhotoIndex, focusPhoto, navigate]);

  const handleDeleteClick = (photoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(photoId);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;

    setDeleting(confirmDelete);
    setDeleteError(null);

    try {
      await api.photos.delete(confirmDelete);
      setPhotos((prev) => prev.filter((p) => p.id !== confirmDelete));
      setConfirmDelete(null);
    } catch {
      setDeleteError('Failed to delete photo');
    } finally {
      setDeleting(null);
    }
  };

  const handleUploadComplete = () => {
    setShowUploadModal(false);
    restoreUploadFocus();
    loadPhotos();
    setSuccessMessage('Photo uploaded successfully');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleUploadModalClose = () => {
    setShowUploadModal(false);
    restoreUploadFocus();
  };

  const handleDeleteCancel = () => {
    const photoIdToFocus = confirmDelete;
    setConfirmDelete(null);
    setDeleteError(null);
    if (photoIdToFocus) {
      deleteButtonRefs.current.get(photoIdToFocus)?.focus();
    }
  };

  const handleFeedReactionClick = async (photoId: string, emoji: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo || !user) return;

    const previousReaction = photo.userReaction;
    const previousReactions = photo.reactions;
    const previousDetails = feedReactionDetails.get(photoId);

    const isRemoving = photo.userReaction === emoji;
    const newUserReaction = isRemoving ? null : emoji;

    let newReactions: ReactionSummary[];
    if (isRemoving) {
      newReactions = photo.reactions
        .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1 } : r))
        .filter((r) => r.count > 0);
    } else {
      let updated = [...photo.reactions];
      if (previousReaction) {
        updated = updated
          .map((r) => (r.emoji === previousReaction ? { ...r, count: r.count - 1 } : r))
          .filter((r) => r.count > 0);
      }
      const existing = updated.find((r) => r.emoji === emoji);
      if (existing) {
        newReactions = updated.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r));
      } else {
        newReactions = [...updated, { emoji, count: 1 }];
      }
    }

    // Optimistic update for photos
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId ? { ...p, userReaction: newUserReaction, reactions: newReactions } : p
      )
    );

    // Optimistic update for reaction details (if loaded)
    if (previousDetails) {
      let newDetails = previousDetails.filter((r) => r.userId !== user.id);
      if (!isRemoving) {
        newDetails = [...newDetails, { emoji, userId: user.id, userName: user.name }];
      }
      setFeedReactionDetails((prev) => new Map(prev).set(photoId, newDetails));
    }

    setFeedReactionPickerPhotoId(null);
    feedReactionTriggerRefs.current.get(photoId)?.focus();

    try {
      if (isRemoving) {
        await api.photos.removeReaction(photoId);
      } else {
        await api.photos.addReaction(photoId, emoji);
      }
    } catch (err) {
      console.error('Failed to update reaction:', err);
      // Revert on error
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? { ...p, userReaction: previousReaction, reactions: previousReactions }
            : p
        )
      );
      if (previousDetails) {
        setFeedReactionDetails((prev) => new Map(prev).set(photoId, previousDetails));
      }
    }
  };

  const handleFeedReactionKeyDown = (e: React.KeyboardEvent, index: number, photoId: string) => {
    const direction = getNavDirection(e);
    if (direction === 'right') {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, EMOJI_OPTIONS.length - 1);
      feedReactionOptionRefs.current[nextIndex]?.focus();
    } else if (direction === 'left') {
      e.preventDefault();
      const prevIndex = Math.max(index - 1, 0);
      feedReactionOptionRefs.current[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      feedReactionOptionRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      feedReactionOptionRefs.current[EMOJI_OPTIONS.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setFeedReactionPickerPhotoId(null);
      feedReactionTriggerRefs.current.get(photoId)?.focus();
    }
  };

  const handleFeedReactionTriggerKeyDown = (e: React.KeyboardEvent, photoId: string) => {
    if (isHorizontalNavKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      setFeedReactionPickerPhotoId(photoId);
    }
  };

  const handleFeedReactionPickerBlur = useCallback((e: React.FocusEvent) => {
    if (!feedReactionPickerRef.current?.contains(e.relatedTarget as Node)) {
      setFeedReactionPickerPhotoId(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary mb-4">{error}</p>
        <button onClick={loadPhotos} className="btn-primary">
          Try again
        </button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <>
        <div className="text-center py-16">
          <p className="text-text-secondary mb-2">No photos yet</p>
          <p className="text-sm text-text-muted mb-4">
            {isAdmin
              ? 'Upload your first photo to get started.'
              : 'Photos will appear here once they are uploaded.'}
          </p>
          {isAdmin && (
            <button
              ref={uploadButtonRef}
              onClick={() => setShowUploadModal(true)}
              className="btn-primary"
            >
              Upload photo
            </button>
          )}
        </div>
        {showUploadModal && (
          <Modal title="Upload photo" onClose={handleUploadModalClose} maxWidth="md">
            <PhotoUpload isModal onUploadComplete={handleUploadComplete} />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <div className="max-w-[540px] mx-auto">
        {isAdmin && (
          <div className="flex justify-end mb-4">
            <button
              ref={uploadButtonRef}
              onClick={() => setShowUploadModal(true)}
              className="btn-primary-sm flex items-center gap-2"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload
            </button>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm">
            {successMessage}
          </div>
        )}
        <div className="flex flex-col gap-6" role="list" aria-label="Photo feed">
          {photos.map((photo, index) => (
            <article
              key={photo.id}
              ref={(el) => {
                photoRefs.current[index] = el;
              }}
              onClick={() => navigate(`/photo/${photo.id}`)}
              onKeyDown={(e) => handlePhotoKeyDown(e, index)}
              tabIndex={0}
              role="listitem"
              aria-label={photo.caption || `Photo ${index + 1}`}
              className="cursor-pointer bg-surface rounded-xl border border-border shadow-card transition-shadow hover:shadow-elevated"
            >
              <div className="relative bg-bg-secondary overflow-hidden rounded-t-xl">
                <img
                  src={`${API_BASE_URL}/photos/${photo.id}/thumbnail?token=${token}`}
                  alt={photo.caption || ''}
                  className="w-full h-auto block max-h-[400px] object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-4 px-5">
                {photo.caption && (
                  <p className="text-text-primary mb-2 leading-normal">{photo.caption}</p>
                )}
                <div className="mb-2">
                  <ReactionPills
                    reactions={photo.reactions}
                    userReaction={photo.userReaction}
                    onReactionClick={(emoji) => handleFeedReactionClick(photo.id, emoji)}
                    onAddClick={() =>
                      setFeedReactionPickerPhotoId(
                        feedReactionPickerPhotoId === photo.id ? null : photo.id
                      )
                    }
                    showPicker={feedReactionPickerPhotoId === photo.id}
                    pickerRef={feedReactionPickerRef}
                    triggerRef={(el) => {
                      if (el) {
                        feedReactionTriggerRefs.current.set(photo.id, el);
                      } else {
                        feedReactionTriggerRefs.current.delete(photo.id);
                      }
                    }}
                    optionRefs={feedReactionOptionRefs}
                    onPickerBlur={handleFeedReactionPickerBlur}
                    onTriggerKeyDown={(e) => handleFeedReactionTriggerKeyDown(e, photo.id)}
                    onOptionKeyDown={(e, index) => handleFeedReactionKeyDown(e, index, photo.id)}
                    onPickerSelect={(emoji) => handleFeedReactionClick(photo.id, emoji)}
                    reactionDetails={feedReactionDetails.get(photo.id)}
                    onLoadReactionDetails={() => loadFeedReactionDetails(photo.id)}
                    currentUserId={user?.id}
                    showNames={true}
                    pickerPosition="above"
                    useViewportPositioning={true}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-text-muted">
                      {formatRelativeTime(photo.uploadedAt)}
                    </p>
                    {photo.commentCount > 0 && (
                      <span className="text-xs text-text-muted">
                        {photo.commentCount} {photo.commentCount === 1 ? 'comment' : 'comments'}
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      ref={(el) => {
                        if (el) {
                          deleteButtonRefs.current.set(photo.id, el);
                        } else {
                          deleteButtonRefs.current.delete(photo.id);
                        }
                      }}
                      onClick={(e) => handleDeleteClick(photo.id, e)}
                      disabled={deleting === photo.id}
                      className={`text-xs text-error bg-transparent border-none py-1 px-2 rounded transition-colors ${
                        deleting === photo.id
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer hover:bg-error/10'
                      }`}
                    >
                      {deleting === photo.id ? 'Deleting...' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {selectedPhoto && selectedPhotoIndex !== null && selectedPhotoIndex >= 0 && (
        <Lightbox
          photos={photos}
          initialIndex={selectedPhotoIndex}
          token={token}
          onClose={handleLightboxClose}
          onIndexChange={(index) => {
            navigate(`/photo/${photos[index].id}`, { replace: true });
          }}
          isAdmin={isAdmin}
          onPhotoUpdate={(updatedPhoto) => {
            setPhotos((prev) =>
              prev.map((p) => (p.id === updatedPhoto.id ? { ...p, ...updatedPhoto } : p))
            );
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete photo"
          message={
            deleteError || 'Are you sure you want to delete this photo? This cannot be undone.'
          }
          confirmLabel="Delete"
          variant="danger"
          isLoading={deleting === confirmDelete}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}

      {showUploadModal && (
        <Modal title="Upload photo" onClose={handleUploadModalClose} maxWidth="md">
          <PhotoUpload isModal onUploadComplete={handleUploadComplete} />
        </Modal>
      )}
    </>
  );
}

interface Comment {
  id: string;
  userId: string | null;
  authorName: string;
  content: string;
  createdAt: number;
  isDeleted: boolean;
}

function ProgressiveImage({
  thumbnailSrc,
  fullSrc,
  alt,
}: {
  thumbnailSrc: string;
  fullSrc: string;
  alt: string;
}) {
  // Check if image is already in browser cache on mount/src change
  const [fullLoaded, setFullLoaded] = useState(() => {
    const img = new Image();
    img.src = fullSrc;
    return img.complete && img.naturalWidth > 0;
  });
  const [fullError, setFullError] = useState(false);

  // Handle src changes when component is reused (no key remount)
  // Use RAF to avoid synchronous setState in effect (lint rule)
  useEffect(() => {
    const img = new Image();
    img.src = fullSrc;

    const rafId = requestAnimationFrame(() => {
      setFullLoaded(img.complete && img.naturalWidth > 0);
      setFullError(false);
    });

    return () => cancelAnimationFrame(rafId);
  }, [fullSrc]);

  const showThumbnail = !fullLoaded || fullError;

  return (
    <div className="relative w-full h-full">
      {/* Thumbnail - always renders, fades out when full loads (unless full errored) */}
      <img
        src={thumbnailSrc}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-contain rounded-lg transition-opacity duration-300 ${
          showThumbnail ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Full image - fades in when loaded, hidden on error */}
      {!fullError && (
        <img
          src={fullSrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-contain rounded-lg transition-opacity duration-300 ${
            fullLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setFullLoaded(true)}
          onError={() => setFullError(true)}
        />
      )}
    </div>
  );
}

const SORT_OPTIONS: Array<{ value: 'newest' | 'oldest'; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

interface CommentPanelProps {
  reactions: ReactionSummary[];
  userReaction: string | null;
  comments: Comment[];
  commentsExpanded: boolean;
  currentUserId?: string;
  isAdmin: boolean;
  reactionPillsProps: Omit<ReactionPillsProps, 'reactions' | 'userReaction'>;
  commentSortOrder: 'newest' | 'oldest';
  onSortOrderChange: (order: 'newest' | 'oldest') => void;
  onToggleExpanded: () => void;
  onDeleteComment: (commentId: string) => void;
  deletingCommentId: string | null;
  loadingComments: boolean;
  commentInputRef: React.RefObject<HTMLInputElement | null>;
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onSubmitComment: (e: React.FormEvent) => void;
  submittingComment: boolean;
}

function CommentPanel({
  reactions,
  userReaction,
  comments,
  commentsExpanded,
  currentUserId,
  isAdmin,
  reactionPillsProps,
  commentSortOrder,
  onSortOrderChange,
  onToggleExpanded,
  onDeleteComment,
  deletingCommentId,
  loadingComments,
  commentInputRef,
  newComment,
  onNewCommentChange,
  onSubmitComment,
  submittingComment,
}: CommentPanelProps) {
  const sortedComments = useMemo(
    () =>
      [...comments].sort((a, b) =>
        commentSortOrder === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
      ),
    [comments, commentSortOrder]
  );

  const reactionPillsElement = (
    <ReactionPills reactions={reactions} userReaction={userReaction} {...reactionPillsProps} />
  );

  const commentCount = comments.length;

  const arrowIcon = (
    <>
      {/* Portrait: up/down arrows */}
      <svg
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        className="landscape:hidden"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={commentsExpanded ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
        />
      </svg>
      {/* Landscape: left/right arrows */}
      <svg
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        className="hidden landscape:block"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={commentsExpanded ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
        />
      </svg>
    </>
  );

  const expandCollapseButton = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpanded();
      }}
      className="p-2 rounded-lg transition-colors text-text-muted flex-shrink-0 hover:bg-bg-tertiary hover:text-text-secondary cursor-pointer flex items-center gap-2 landscape:flex-col landscape:gap-2.5"
      aria-label={
        commentsExpanded
          ? `Collapse comments (${commentCount} ${commentCount === 1 ? 'comment' : 'comments'})`
          : `Expand comments (${commentCount} ${commentCount === 1 ? 'comment' : 'comments'})`
      }
    >
      <span aria-hidden="true">{arrowIcon}</span>
      {!commentsExpanded && (
        <span className="relative text-xl" aria-hidden="true">
          💬
          <span className="absolute -top-2 -right-2.5 min-w-[1.25rem] h-[1.25rem] px-1 flex items-center justify-center text-xs font-semibold bg-accent text-white rounded-full shadow-sm">
            {commentCount}
          </span>
        </span>
      )}
    </button>
  );

  return (
    <div
      className={`bg-surface/95 backdrop-blur rounded-lg h-full flex flex-col ${
        !commentsExpanded ? 'max-w-[900px] landscape:max-w-none mx-auto landscape:mx-0' : ''
      }`}
    >
      {!commentsExpanded ? (
        /* Collapsed state - row in portrait (reactions left, comments right), column in landscape (reactions top, comments bottom) */
        <div className="flex items-center justify-between p-2 px-3 landscape:flex-col landscape:items-stretch landscape:justify-between landscape:flex-1 landscape:p-3">
          <div className="landscape:[&>div]:flex-col landscape:[&>div]:items-start">
            {reactionPillsElement}
          </div>
          <div className="landscape:self-start">{expandCollapseButton}</div>
        </div>
      ) : (
        /* Expanded state */
        <>
          {/* Header with reactions and controls */}
          <div className="flex-shrink-0 p-3 border-b border-border">
            <div className="flex items-center gap-3 flex-wrap">
              {reactionPillsElement}
              <div className="ml-auto flex items-center gap-2">
                {!loadingComments && (
                  <SelectDropdown
                    value={commentSortOrder}
                    onChange={onSortOrderChange}
                    options={SORT_OPTIONS}
                    ariaLabel="Sort order"
                  />
                )}
                {expandCollapseButton}
              </div>
            </div>
          </div>

          {/* Comments section */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {loadingComments ? (
              <div className="flex justify-center py-4">
                <div className="spinner-sm" />
              </div>
            ) : sortedComments.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-4">No comments yet</p>
            ) : (
              <div className="space-y-3">
                {sortedComments.map((comment) => (
                  <div key={comment.id} className="text-sm">
                    <div className="flex justify-between items-start gap-2">
                      <span
                        className={
                          comment.isDeleted
                            ? 'font-medium text-text-muted'
                            : 'font-medium text-text-primary'
                        }
                      >
                        {comment.isDeleted ? `(deleted) ${comment.authorName}` : comment.authorName}
                      </span>
                      {(comment.userId === currentUserId || isAdmin) && !comment.isDeleted && (
                        <button
                          onClick={() => onDeleteComment(comment.id)}
                          disabled={deletingCommentId === comment.id}
                          className="text-xs text-text-muted hover:text-error transition-colors cursor-pointer flex-shrink-0"
                        >
                          {deletingCommentId === comment.id ? '...' : 'Delete'}
                        </button>
                      )}
                    </div>
                    <p className="text-text-secondary mt-0.5 break-words">{comment.content}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {formatRelativeTime(comment.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comment input */}
          <form onSubmit={onSubmitComment} className="flex-shrink-0 p-3 border-t border-border">
            <div className="flex gap-2">
              <input
                ref={commentInputRef}
                type="text"
                value={newComment}
                onChange={(e) => onNewCommentChange(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={submittingComment}
              />
              <button
                type="submit"
                disabled={!newComment.trim() || submittingComment}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors cursor-pointer flex-shrink-0"
              >
                {submittingComment ? '...' : 'Post'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function Lightbox({
  photos,
  initialIndex,
  token,
  onClose,
  onIndexChange,
  isAdmin,
  onPhotoUpdate,
}: {
  photos: Photo[];
  initialIndex: number;
  token: string;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  isAdmin: boolean;
  onPhotoUpdate: (photo: Partial<Photo> & { id: string }) => void;
}) {
  const { user } = useAuth();

  // Local state for expanded/collapsed - resets when lightbox closes
  const [commentsExpanded, setCommentsExpanded] = useState(false);

  const isPortrait = useIsPortrait();

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const commentsPanelRef = useRef<HTMLDivElement>(null);
  const carouselContainerRef = useRef<HTMLDivElement>(null);

  // Virtual carousel for smooth, unlimited swiping
  const {
    centerIndex,
    offset,
    isAnimating,
    visibleIndices,
    handlers: swipeHandlers,
    reset: resetCarousel,
  } = useVirtualCarousel({
    totalCount: photos.length,
    initialIndex,
    onIndexChange,
    windowSize: 5,
    excludeRef: commentsPanelRef,
    containerRef: carouselContainerRef,
  });

  // Current photo based on carousel position
  const photo = photos[centerIndex];
  const prevPhoto = centerIndex > 0 ? photos[centerIndex - 1] : undefined;
  const nextPhoto = centerIndex < photos.length - 1 ? photos[centerIndex + 1] : undefined;

  const [userReaction, setUserReaction] = useState<string | null>(photo.userReaction);
  const [reactions, setReactions] = useState<ReactionSummary[]>(photo.reactions);
  const [reactionDetails, setReactionDetails] = useState<ReactionWithUser[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [loadingReactionDetails, setLoadingReactionDetails] = useState(false);

  const currentReactionIndex = userReaction ? EMOJI_OPTIONS.indexOf(userReaction) : 0;
  const {
    containerRef: reactionPickerRef,
    triggerRef: reactionTriggerRef,
    optionRefs: reactionOptionRefs,
    handleOptionKeyDown: handleReactionOptionKeyDown,
    handleBlur: handleReactionPickerBlur,
  } = useDropdown({
    isOpen: showReactionPicker,
    onClose: () => setShowReactionPicker(false),
    itemCount: EMOJI_OPTIONS.length,
    initialFocusIndex: currentReactionIndex >= 0 ? currentReactionIndex : 0,
    horizontal: true,
  });

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentSortOrder, setCommentSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  const [deleteCommentError, setDeleteCommentError] = useState<string | null>(null);

  // In-memory cache for comments and reaction details (cleared when lightbox closes)
  const commentsCache = useRef<Map<string, Comment[]>>(new Map());
  const reactionDetailsCache = useRef<Map<string, ReactionWithUser[]>>(new Map());

  // Sync carousel when initialIndex changes externally (e.g., keyboard navigation)
  useLayoutEffect(() => {
    if (initialIndex !== centerIndex) {
      resetCarousel(initialIndex);
    }
  }, [initialIndex, centerIndex, resetCarousel]);

  // Reset other state when navigating to a different photo (restore from cache if available)
  // useLayoutEffect ensures state is synced before browser paint, preventing flash of old data
  useLayoutEffect(() => {
    setUserReaction(photo.userReaction);
    setReactions(photo.reactions);
    setShowReactionPicker(false);
    setNewComment('');

    // Restore from cache if available
    const cachedComments = commentsCache.current.get(photo.id);
    const cachedReactionDetails = reactionDetailsCache.current.get(photo.id);
    setComments(cachedComments ?? []);
    setReactionDetails(cachedReactionDetails ?? []);
    // We intentionally only sync from photo props when the photo ID changes,
    // not when reactions/userReaction update (local state may be more current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  // Preload adjacent images
  useEffect(() => {
    if (nextPhoto) {
      const img = new Image();
      img.src = `${API_BASE_URL}/photos/${nextPhoto.id}/download?token=${token}`;
    }
    if (prevPhoto) {
      const img = new Image();
      img.src = `${API_BASE_URL}/photos/${prevPhoto.id}/download?token=${token}`;
    }
  }, [photo.id, nextPhoto, prevPhoto, token]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Disable body scroll while lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleReactionTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isHorizontalNavKey(e)) {
      e.preventDefault();
      setShowReactionPicker(true);
    }
  };

  const loadComments = useCallback(async () => {
    // Skip fetch if we already have cached comments for this photo
    if (commentsCache.current.has(photo.id)) {
      return;
    }

    setLoadingComments(true);
    try {
      const data = await api.photos.getComments(photo.id);
      setComments(data.comments);
      commentsCache.current.set(photo.id, data.comments);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }, [photo.id]);

  // Load comments
  useEffect(() => {
    // Set loading immediately if we'll need to fetch (no cache)
    if (!commentsCache.current.has(photo.id)) {
      setLoadingComments(true);
    }
    loadComments();
  }, [loadComments, photo.id]);

  // Preload comments for adjacent photos
  useEffect(() => {
    const preloadComments = async (photoId: string) => {
      if (commentsCache.current.has(photoId)) return;
      try {
        const data = await api.photos.getComments(photoId);
        commentsCache.current.set(photoId, data.comments);
      } catch {
        // Silently fail preloading
      }
    };

    if (prevPhoto) preloadComments(prevPhoto.id);
    if (nextPhoto) preloadComments(nextPhoto.id);
  }, [photo.id, prevPhoto, nextPhoto]);

  const loadReactionDetails = useCallback(async () => {
    if (loadingReactionDetails) return;

    // Use cached data if available
    const cached = reactionDetailsCache.current.get(photo.id);
    if (cached) {
      setReactionDetails(cached);
      return;
    }

    setLoadingReactionDetails(true);
    try {
      const data = await api.photos.getReactions(photo.id);
      setReactionDetails(data.reactions);
      reactionDetailsCache.current.set(photo.id, data.reactions);
    } catch (err) {
      console.error('Failed to load reaction details:', err);
    } finally {
      setLoadingReactionDetails(false);
    }
  }, [photo.id, loadingReactionDetails]);

  // Load reaction details
  useEffect(() => {
    if (reactions.length > 0) {
      loadReactionDetails();
    }
  }, [reactions.length, loadReactionDetails]);

  // Preload reaction details for adjacent photos
  useEffect(() => {
    const preloadReactionDetails = async (photoId: string, hasReactions: boolean) => {
      if (!hasReactions || reactionDetailsCache.current.has(photoId)) return;
      try {
        const data = await api.photos.getReactions(photoId);
        reactionDetailsCache.current.set(photoId, data.reactions);
      } catch {
        // Silently fail preloading
      }
    };

    if (prevPhoto) preloadReactionDetails(prevPhoto.id, prevPhoto.reactions.length > 0);
    if (nextPhoto) preloadReactionDetails(nextPhoto.id, nextPhoto.reactions.length > 0);
  }, [photo.id, prevPhoto, nextPhoto]);

  const handleReactionClick = async (emoji: string) => {
    if (!user) return;

    const previousReaction = userReaction;
    const previousReactions = reactions;
    const previousDetails = reactionDetails;

    // Compute new values first
    const isRemoving = userReaction === emoji;
    const newUserReaction = isRemoving ? null : emoji;

    let newReactions: ReactionSummary[];
    if (isRemoving) {
      newReactions = reactions
        .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1 } : r))
        .filter((r) => r.count > 0);
    } else {
      let updated = [...reactions];
      if (previousReaction) {
        updated = updated
          .map((r) => (r.emoji === previousReaction ? { ...r, count: r.count - 1 } : r))
          .filter((r) => r.count > 0);
      }
      const existing = updated.find((r) => r.emoji === emoji);
      if (existing) {
        newReactions = updated.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r));
      } else {
        newReactions = [...updated, { emoji, count: 1 }];
      }
    }

    // Optimistic update
    setUserReaction(newUserReaction);
    setReactions(newReactions);

    // Optimistic update for reaction details
    let newDetails = reactionDetails.filter((r) => r.userId !== user.id);
    if (!isRemoving) {
      newDetails = [...newDetails, { emoji, userId: user.id, userName: user.name }];
    }
    setReactionDetails(newDetails);
    reactionDetailsCache.current.set(photo.id, newDetails);

    try {
      if (isRemoving) {
        await api.photos.removeReaction(photo.id);
      } else {
        await api.photos.addReaction(photo.id, emoji);
      }
      // Update parent with computed values
      onPhotoUpdate({
        id: photo.id,
        userReaction: newUserReaction,
        reactions: newReactions,
      });
    } catch (err) {
      // Revert on error
      console.error('Failed to update reaction:', err);
      setUserReaction(previousReaction);
      setReactions(previousReactions);
      setReactionDetails(previousDetails);
      reactionDetailsCache.current.set(photo.id, previousDetails);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submittingComment) return;

    setSubmittingComment(true);
    try {
      const result = await api.photos.addComment(photo.id, newComment.trim());
      const newCommentObj: Comment = {
        id: result.id,
        userId: user?.id ?? null,
        authorName: user?.name ?? 'You',
        content: newComment.trim(),
        createdAt: Math.floor(Date.now() / 1000),
        isDeleted: false,
      };
      setComments((prev) => {
        const updated = [newCommentObj, ...prev];
        commentsCache.current.set(photo.id, updated);
        return updated;
      });
      setNewComment('');
      onPhotoUpdate({ id: photo.id, commentCount: photo.commentCount + 1 });
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = (commentId: string) => {
    setConfirmDeleteCommentId(commentId);
    setDeleteCommentError(null);
  };

  const handleDeleteCommentConfirm = async () => {
    if (!confirmDeleteCommentId) return;

    setDeletingCommentId(confirmDeleteCommentId);
    setDeleteCommentError(null);

    try {
      await api.photos.deleteComment(photo.id, confirmDeleteCommentId);
      setComments((prev) => {
        const updated = prev.filter((c) => c.id !== confirmDeleteCommentId);
        commentsCache.current.set(photo.id, updated);
        return updated;
      });
      onPhotoUpdate({ id: photo.id, commentCount: Math.max(0, photo.commentCount - 1) });
      setConfirmDeleteCommentId(null);
    } catch (err) {
      console.error('Failed to delete comment:', err);
      setDeleteCommentError('Failed to delete comment');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleDeleteCommentCancel = () => {
    setConfirmDeleteCommentId(null);
    setDeleteCommentError(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle navigation keys when typing in comment input
      if (document.activeElement === commentInputRef.current) {
        if (e.key === 'Escape') {
          commentInputRef.current?.blur();
        }
        return;
      }

      // Don't handle keys when reaction picker is open (it has its own handlers)
      if (showReactionPicker) {
        return;
      }

      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const direction = getNavDirection(e);
      if (direction === 'left' && centerIndex > 0) {
        e.preventDefault();
        onIndexChange(centerIndex - 1);
      } else if (direction === 'right' && centerIndex < photos.length - 1) {
        e.preventDefault();
        onIndexChange(centerIndex + 1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onIndexChange, centerIndex, photos.length, showReactionPicker]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black"
      role="dialog"
      aria-label={`Photo ${centerIndex + 1} of ${photos.length}`}
    >
      {/* Main layout: portrait = column, landscape = row */}
      <div className="h-full w-full flex flex-col landscape:flex-row">
        {/* Photo container - has relative positioning for nav buttons */}
        <div
          onClick={onClose}
          className={`relative min-h-0 landscape:min-w-0 overflow-hidden flex-1 ${
            commentsExpanded ? 'h-[55%] landscape:h-full' : ''
          }`}
        >
          {/* Close button - top right of photo area */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer flex items-center justify-center text-white transition-colors hover:bg-white/20"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {/* Previous button - left of photo area */}
          {centerIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange(centerIndex - 1);
              }}
              aria-label="Previous photo"
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer hidden md:flex items-center justify-center text-white transition-colors hover:bg-white/20"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}

          {/* Next button - right of photo area */}
          {centerIndex < photos.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange(centerIndex + 1);
              }}
              aria-label="Next photo"
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer hidden md:flex items-center justify-center text-white transition-colors hover:bg-white/20"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}

          {/* Carousel for swiping photos */}
          <div ref={carouselContainerRef} className="h-full" {...swipeHandlers}>
            <div
              className={`h-full flex ${isAnimating ? 'transition-transform duration-300 ease-out' : ''}`}
              style={{
                transform: `translateX(calc(-${visibleIndices.indexOf(centerIndex) * 100}% + ${offset}px))`,
              }}
            >
              {visibleIndices.map((photoIndex) => {
                if (photoIndex < 0 || photoIndex >= photos.length) {
                  return (
                    <div
                      key={`placeholder-${photoIndex}`}
                      className="flex-shrink-0 w-full h-full"
                    />
                  );
                }

                const slidePhoto = photos[photoIndex];
                return (
                  <div
                    key={slidePhoto.id}
                    className="flex-shrink-0 w-full h-full flex items-center justify-center p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ProgressiveImage
                      thumbnailSrc={`${API_BASE_URL}/photos/${slidePhoto.id}/thumbnail?token=${token}`}
                      fullSrc={`${API_BASE_URL}/photos/${slidePhoto.id}/download?token=${token}`}
                      alt={slidePhoto.caption || `Photo ${photoIndex + 1}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Comments container */}
        <div
          ref={commentsPanelRef}
          onClick={(e) => e.stopPropagation()}
          className={`p-2 pt-0 landscape:pt-2 landscape:pl-0 flex-shrink-0 ${
            commentsExpanded
              ? 'h-[45%] landscape:h-full landscape:w-[min(35%,28rem)]'
              : 'landscape:max-w-[280px]'
          }`}
        >
          <CommentPanel
            reactions={reactions}
            userReaction={userReaction}
            comments={comments}
            commentsExpanded={commentsExpanded}
            currentUserId={user?.id}
            isAdmin={isAdmin}
            reactionPillsProps={{
              onReactionClick: (emoji) => {
                handleReactionClick(emoji);
                setShowReactionPicker(false);
                reactionTriggerRef.current?.focus();
              },
              onAddClick: () => setShowReactionPicker(!showReactionPicker),
              showPicker: showReactionPicker,
              pickerRef: reactionPickerRef,
              triggerRef: (el) => {
                reactionTriggerRef.current = el;
              },
              optionRefs: reactionOptionRefs,
              onPickerBlur: handleReactionPickerBlur,
              onTriggerKeyDown: handleReactionTriggerKeyDown,
              onOptionKeyDown: handleReactionOptionKeyDown,
              pickerPosition: isPortrait ? 'above' : 'below',
              useViewportPositioning: isPortrait,
              reactionDetails: reactionDetails,
              onLoadReactionDetails: loadReactionDetails,
              currentUserId: user?.id,
              showNames: true,
            }}
            commentSortOrder={commentSortOrder}
            onSortOrderChange={setCommentSortOrder}
            onToggleExpanded={() => setCommentsExpanded(!commentsExpanded)}
            onDeleteComment={handleDeleteComment}
            deletingCommentId={deletingCommentId}
            loadingComments={loadingComments}
            commentInputRef={commentInputRef}
            newComment={newComment}
            onNewCommentChange={setNewComment}
            onSubmitComment={handleSubmitComment}
            submittingComment={submittingComment}
          />
        </div>
      </div>

      {confirmDeleteCommentId && (
        <ConfirmModal
          title="Delete comment"
          message={
            deleteCommentError ||
            'Are you sure you want to delete this comment? This cannot be undone.'
          }
          confirmLabel="Delete"
          variant="danger"
          isLoading={deletingCommentId === confirmDeleteCommentId}
          onConfirm={handleDeleteCommentConfirm}
          onCancel={handleDeleteCommentCancel}
        />
      )}
    </div>
  );
}
