import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE_URL } from '../lib/api';
import { useFocusRestore } from '../lib/hooks';
import { getNavDirection, isHorizontalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { PhotoUpload } from './PhotoUpload';
import { useAuth } from '../contexts/AuthContext';

function useAuthToken() {
  return useMemo(() => localStorage.getItem('accessToken') || '', []);
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
      }, 500);
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
            : 'bg-bg-secondary hover:bg-bg-tertiary'
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
  reactionDetails,
  onLoadReactionDetails,
  currentUserId,
  showNames = false,
}: ReactionPillsProps) {
  const hasLoadedRef = useRef(false);
  const [longPressTooltipEmoji, setLongPressTooltipEmoji] = useState<string | null>(null);

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

  const pickerPositionClass = pickerPosition === 'above' ? 'bottom-full mb-1' : 'top-full mt-1';

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

    const computedReactions: ReactionSummary[] = Object.entries(counts).map(([emoji, count]) => ({
      emoji,
      count,
    }));

    return { computedReactions, reactionsByEmoji: grouped };
  }, [reactionDetails, currentUserId]);

  // Use computed reactions from details if available, otherwise fall back to prop
  const displayReactions = computedReactions ?? reactions;

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
          ref={triggerRef}
          onClick={(e) => {
            e.stopPropagation();
            onAddClick();
          }}
          onKeyDown={onTriggerKeyDown}
          className={`${pillBaseClass} w-9 ${
            showPicker
              ? 'bg-bg-tertiary text-text-primary'
              : 'bg-bg-secondary hover:bg-bg-tertiary text-text-muted'
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
            role="listbox"
            aria-label="Select reaction"
            className={`absolute left-0 ${pickerPositionClass} z-[60] bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1`}
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
  const commentsEnabled = user?.commentsEnabled ?? false;
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
  const token = useAuthToken();
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

  const handleLightboxNav = useCallback(
    (direction: 'prev' | 'next') => {
      if (selectedPhotoIndex === null || selectedPhotoIndex < 0) return;
      const newIndex =
        direction === 'next'
          ? Math.min(selectedPhotoIndex + 1, photos.length - 1)
          : Math.max(selectedPhotoIndex - 1, 0);
      navigate(`/photo/${photos[newIndex].id}`, { replace: true });
    },
    [selectedPhotoIndex, photos, navigate]
  );

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

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

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
                    showNames={commentsEnabled}
                    pickerPosition="above"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-text-muted">{formatDate(photo.uploadedAt)}</p>
                    {commentsEnabled && photo.commentCount > 0 && (
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
          photo={selectedPhoto}
          token={token}
          onClose={handleLightboxClose}
          onPrev={selectedPhotoIndex > 0 ? () => handleLightboxNav('prev') : undefined}
          onNext={
            selectedPhotoIndex < photos.length - 1 ? () => handleLightboxNav('next') : undefined
          }
          currentIndex={selectedPhotoIndex}
          totalCount={photos.length}
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

function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function Lightbox({
  photo,
  token,
  onClose,
  onPrev,
  onNext,
  currentIndex,
  totalCount,
  isAdmin,
  onPhotoUpdate,
}: {
  photo: Photo;
  token: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  currentIndex: number;
  totalCount: number;
  isAdmin: boolean;
  onPhotoUpdate: (photo: Partial<Photo> & { id: string }) => void;
}) {
  const { user, setCommentsEnabled } = useAuth();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const showCommentsButtonRef = useRef<HTMLButtonElement>(null);
  const hideCommentsButtonRef = useRef<HTMLButtonElement>(null);

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

  const commentsEnabled = user?.commentsEnabled ?? false;

  const sortedComments = useMemo(() => {
    if (commentSortOrder === 'oldest') {
      return [...comments].sort((a, b) => a.createdAt - b.createdAt);
    }
    return comments; // Comments already come back from DB sorted by newest
  }, [comments, commentSortOrder]);

  // Reset state when navigating to a different photo (restore from cache if available)
  useEffect(() => {
    setUserReaction(photo.userReaction);
    setReactions(photo.reactions);
    setShowReactionPicker(false);
    setNewComment('');

    // Restore from cache if available
    const cachedComments = commentsCache.current.get(photo.id);
    const cachedReactionDetails = reactionDetailsCache.current.get(photo.id);
    setComments(cachedComments ?? []);
    setReactionDetails(cachedReactionDetails ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

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

  // Load comments when enabled
  useEffect(() => {
    if (commentsEnabled) {
      // Set loading immediately if we'll need to fetch (no cache)
      if (!commentsCache.current.has(photo.id)) {
        setLoadingComments(true);
      }
      loadComments();
    }
  }, [commentsEnabled, loadComments, photo.id]);

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

  // Load reaction details when comments are enabled
  useEffect(() => {
    if (commentsEnabled && reactions.length > 0) {
      loadReactionDetails();
    }
  }, [commentsEnabled, reactions.length, loadReactionDetails]);

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

  const handleShowComments = () => {
    setCommentsEnabled(true).catch((err) => {
      console.error('Failed to enable comments:', err);
    });
    setTimeout(() => hideCommentsButtonRef.current?.focus(), 0);
  };

  const handleHideComments = () => {
    setCommentsEnabled(false).catch((err) => {
      console.error('Failed to hide comments:', err);
    });
    setTimeout(() => showCommentsButtonRef.current?.focus(), 0);
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
      if (direction === 'left') {
        e.preventDefault();
        onPrev?.();
      } else if (direction === 'right') {
        e.preventDefault();
        onNext?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrev, onNext, showReactionPicker]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current !== null) {
      e.preventDefault();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        onNext?.();
      } else {
        onPrev?.();
      }
    }

    touchStartX.current = null;
  };

  return (
    <div
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 flex flex-col md:flex-row items-center justify-center bg-black/90 touch-none"
      role="dialog"
      aria-label={`Photo ${currentIndex + 1} of ${totalCount}`}
    >
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

      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous photo"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer hidden md:flex items-center justify-center text-white transition-colors hover:bg-white/20"
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

      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next photo"
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer hidden md:flex items-center justify-center text-white transition-colors hover:bg-white/20"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main content area */}
      <div onClick={(e) => e.stopPropagation()} className="h-full w-full flex flex-col">
        {/* Upper section: image + counter - takes remaining space after bottom strip */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Image container */}
          <div className="flex-1 min-h-0 flex items-center justify-center px-4 md:px-16 pt-4">
            <img
              src={`${API_BASE_URL}/photos/${photo.id}/download?token=${token}`}
              alt={photo.caption || 'Photo'}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
          {/* Photo counter */}
          <div className="flex-shrink-0 text-center text-white/70 text-sm py-2">
            {currentIndex + 1} / {totalCount}
          </div>
        </div>

        {/* Bottom strip with reactions and comments - shrinks, max 40vh when expanded */}
        <div className={`flex-shrink-0 w-full px-4 pb-4 ${commentsEnabled ? 'max-h-[40vh]' : ''}`}>
          <div
            className={`max-w-[900px] mx-auto flex flex-col bg-surface/95 backdrop-blur rounded-lg ${
              commentsEnabled ? 'h-full' : ''
            }`}
          >
            {/* Collapsed state - short wide strip */}
            {!commentsEnabled ? (
              <div className="flex items-center gap-3 p-2 px-3">
                <ReactionPills
                  reactions={reactions}
                  userReaction={userReaction}
                  onReactionClick={(emoji) => {
                    handleReactionClick(emoji);
                    setShowReactionPicker(false);
                    reactionTriggerRef.current?.focus();
                  }}
                  onAddClick={() => setShowReactionPicker(!showReactionPicker)}
                  showPicker={showReactionPicker}
                  pickerRef={reactionPickerRef}
                  triggerRef={(el) => {
                    reactionTriggerRef.current = el;
                  }}
                  optionRefs={reactionOptionRefs}
                  onPickerBlur={handleReactionPickerBlur}
                  onTriggerKeyDown={handleReactionTriggerKeyDown}
                  onOptionKeyDown={handleReactionOptionKeyDown}
                  pickerPosition="above"
                  reactionDetails={reactionDetails}
                  onLoadReactionDetails={loadReactionDetails}
                  currentUserId={user?.id}
                  showNames={commentsEnabled}
                />

                {/* Show comments button - pushed to right */}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-text-muted">Comments hidden</span>
                  <button
                    ref={showCommentsButtonRef}
                    onClick={handleShowComments}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-secondary text-sm cursor-pointer"
                  >
                    Show
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Expanded state */}
                {/* Header with reactions */}
                <div className="p-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <ReactionPills
                      reactions={reactions}
                      userReaction={userReaction}
                      onReactionClick={(emoji) => {
                        handleReactionClick(emoji);
                        setShowReactionPicker(false);
                        reactionTriggerRef.current?.focus();
                      }}
                      onAddClick={() => setShowReactionPicker(!showReactionPicker)}
                      showPicker={showReactionPicker}
                      pickerRef={reactionPickerRef}
                      triggerRef={(el) => {
                        reactionTriggerRef.current = el;
                      }}
                      optionRefs={reactionOptionRefs}
                      onPickerBlur={handleReactionPickerBlur}
                      onTriggerKeyDown={handleReactionTriggerKeyDown}
                      onOptionKeyDown={handleReactionOptionKeyDown}
                      pickerPosition="above"
                      reactionDetails={reactionDetails}
                      onLoadReactionDetails={loadReactionDetails}
                      currentUserId={user?.id}
                      showNames={commentsEnabled}
                    />

                    {/* Sort dropdown and collapse button - pushed to right */}
                    <div className="ml-auto flex items-center gap-2">
                      {!loadingComments && sortedComments.length > 1 && (
                        <select
                          value={commentSortOrder}
                          onChange={(e) =>
                            setCommentSortOrder(e.target.value as 'newest' | 'oldest')
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.showPicker?.();
                            }
                          }}
                          className="px-2 py-1 rounded-lg bg-bg-secondary border border-border text-text-muted text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                        </select>
                      )}
                      <button
                        ref={hideCommentsButtonRef}
                        onClick={handleHideComments}
                        className="px-3 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-secondary text-sm cursor-pointer"
                        title="Hide comments"
                      >
                        Hide comments
                      </button>
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
                          <div className="flex justify-between items-start">
                            <span
                              className={
                                comment.isDeleted
                                  ? 'font-medium text-text-muted'
                                  : 'font-medium text-text-primary'
                              }
                            >
                              {comment.isDeleted
                                ? `(deleted) ${comment.authorName}`
                                : comment.authorName}
                            </span>
                            {(comment.userId === user?.id || isAdmin) && !comment.isDeleted && (
                              <button
                                onClick={() => handleDeleteComment(comment.id)}
                                disabled={deletingCommentId === comment.id}
                                className="text-xs text-text-muted hover:text-error transition-colors cursor-pointer"
                              >
                                {deletingCommentId === comment.id ? '...' : 'Delete'}
                              </button>
                            )}
                          </div>
                          <p className="text-text-secondary mt-0.5">{comment.content}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {formatRelativeTime(comment.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Comment input */}
                <form onSubmit={handleSubmitComment} className="p-3 border-t border-border">
                  <div className="flex gap-2">
                    <input
                      ref={commentInputRef}
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      className="flex-1 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={submittingComment}
                    />
                    <button
                      type="submit"
                      disabled={!newComment.trim() || submittingComment}
                      className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors cursor-pointer"
                    >
                      {submittingComment ? '...' : 'Post'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
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
