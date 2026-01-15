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

function ReactionDisplay({ reactions }: { reactions: ReactionSummary[] }) {
  if (reactions.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap">
      {reactions.map(({ emoji, count }) => (
        <span
          key={emoji}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-bg-secondary text-sm"
        >
          <span>{emoji}</span>
          <span className="text-text-primary font-medium">{count}</span>
        </span>
      ))}
    </div>
  );
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
  const token = useAuthToken();
  const [uploadButtonRef, restoreUploadFocus] = useFocusRestore<HTMLButtonElement>();
  const deleteButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const photoRefs = useRef<(HTMLElement | null)[]>([]);
  const feedReactionPickerRef = useRef<HTMLDivElement>(null);
  const feedReactionTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const feedReactionOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = useNavigate();
  const { photoId } = useParams<{ photoId: string }>();

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
    if (!photo) return;

    const previousReaction = photo.userReaction;
    const previousReactions = photo.reactions;

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

    // Optimistic update
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId ? { ...p, userReaction: newUserReaction, reactions: newReactions } : p
      )
    );
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
                <div className="flex items-center gap-2 mb-2">
                  {/* Add reaction button */}
                  <div
                    className="relative"
                    ref={feedReactionPickerPhotoId === photo.id ? feedReactionPickerRef : undefined}
                    onBlur={
                      feedReactionPickerPhotoId === photo.id
                        ? handleFeedReactionPickerBlur
                        : undefined
                    }
                  >
                    <button
                      ref={(el) => {
                        if (el) {
                          feedReactionTriggerRefs.current.set(photo.id, el);
                        } else {
                          feedReactionTriggerRefs.current.delete(photo.id);
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFeedReactionPickerPhotoId(
                          feedReactionPickerPhotoId === photo.id ? null : photo.id
                        );
                      }}
                      onKeyDown={(e) => handleFeedReactionTriggerKeyDown(e, photo.id)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors cursor-pointer ${
                        feedReactionPickerPhotoId === photo.id
                          ? 'bg-primary/20 text-primary'
                          : 'bg-bg-secondary hover:bg-bg-tertiary text-text-muted'
                      }`}
                      aria-label="Add reaction"
                      aria-expanded={feedReactionPickerPhotoId === photo.id}
                      aria-haspopup="listbox"
                    >
                      {photo.userReaction || '+'}
                    </button>

                    {/* Reaction picker dropdown */}
                    {feedReactionPickerPhotoId === photo.id && (
                      <div
                        role="listbox"
                        aria-label="Select reaction"
                        className="absolute left-0 top-full mt-1 z-20 bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1"
                      >
                        {EMOJI_OPTIONS.map((emoji, emojiIndex) => (
                          <button
                            key={emoji}
                            ref={(el) => {
                              feedReactionOptionRefs.current[emojiIndex] = el;
                            }}
                            role="option"
                            aria-selected={photo.userReaction === emoji}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFeedReactionClick(photo.id, emoji);
                            }}
                            onKeyDown={(e) => handleFeedReactionKeyDown(e, emojiIndex, photo.id)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors cursor-pointer ${
                              photo.userReaction === emoji
                                ? 'bg-bg-secondary hover:bg-bg-tertiary'
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

                  {/* Reaction counts */}
                  {photo.reactions.length > 0 && <ReactionDisplay reactions={photo.reactions} />}
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-text-muted">{formatDate(photo.uploadedAt)}</p>
                    {user?.commentsEnabled && photo.commentCount > 0 && (
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

interface ReactionWithUser {
  emoji: string;
  userId: string;
  userName: string;
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
  const reactionPopoverRef = useRef<HTMLDivElement>(null);
  const showCommentsButtonRef = useRef<HTMLButtonElement>(null);
  const hideCommentsButtonRef = useRef<HTMLButtonElement>(null);

  const [userReaction, setUserReaction] = useState<string | null>(photo.userReaction);
  const [reactions, setReactions] = useState<ReactionSummary[]>(photo.reactions);
  const [reactionDetails, setReactionDetails] = useState<ReactionWithUser[]>([]);
  const [showReactionPopover, setShowReactionPopover] = useState(false);
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

  // Reset state when navigating to a different photo (restore from cache if available)
  useEffect(() => {
    setUserReaction(photo.userReaction);
    setReactions(photo.reactions);
    setShowReactionPopover(false);
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

  // Close reaction popover on click outside or escape
  useEffect(() => {
    if (!showReactionPopover) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (reactionPopoverRef.current && !reactionPopoverRef.current.contains(e.target as Node)) {
        setShowReactionPopover(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setShowReactionPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showReactionPopover]);

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

  const loadReactionDetails = async () => {
    if (!commentsEnabled || loadingReactionDetails) return;

    // Use cached data if available
    const cached = reactionDetailsCache.current.get(photo.id);
    if (cached) {
      setReactionDetails(cached);
      setShowReactionPopover(true);
      return;
    }

    setLoadingReactionDetails(true);
    try {
      const data = await api.photos.getReactions(photo.id);
      setReactionDetails(data.reactions);
      reactionDetailsCache.current.set(photo.id, data.reactions);
      setShowReactionPopover(true);
    } catch (err) {
      console.error('Failed to load reaction details:', err);
    } finally {
      setLoadingReactionDetails(false);
    }
  };

  const handleReactionClick = async (emoji: string) => {
    const previousReaction = userReaction;
    const previousReactions = reactions;

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
    // Invalidate reaction details cache since user list changed
    reactionDetailsCache.current.delete(photo.id);

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
        const updated = [...prev, newCommentObj];
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

      // Don't handle keys when reaction picker or popover is open (they have their own handlers)
      if (showReactionPicker || showReactionPopover) {
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
  }, [onClose, onPrev, onNext, showReactionPicker, showReactionPopover]);

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

  // Group reactions by emoji for popover display
  const reactionsByEmoji = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const r of reactionDetails) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.userName);
    }
    return grouped;
  }, [reactionDetails]);

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
                {/* Add reaction button */}
                <div className="relative" ref={reactionPickerRef} onBlur={handleReactionPickerBlur}>
                  <button
                    ref={reactionTriggerRef}
                    onClick={() => setShowReactionPicker(!showReactionPicker)}
                    onKeyDown={handleReactionTriggerKeyDown}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-colors cursor-pointer ${
                      showReactionPicker
                        ? 'bg-primary/20 text-primary'
                        : 'bg-bg-secondary hover:bg-bg-tertiary text-text-muted'
                    }`}
                    aria-label="Add reaction"
                    aria-expanded={showReactionPicker}
                    aria-haspopup="listbox"
                  >
                    {userReaction || '+'}
                  </button>

                  {/* Reaction picker dropdown */}
                  {showReactionPicker && (
                    <div
                      role="listbox"
                      aria-label="Select reaction"
                      className="absolute left-0 bottom-full mb-1 z-[60] bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1"
                    >
                      {EMOJI_OPTIONS.map((emoji, index) => (
                        <button
                          key={emoji}
                          ref={(el) => {
                            reactionOptionRefs.current[index] = el;
                          }}
                          role="option"
                          aria-selected={userReaction === emoji}
                          onClick={() => {
                            handleReactionClick(emoji);
                            setShowReactionPicker(false);
                            reactionTriggerRef.current?.focus();
                          }}
                          onKeyDown={(e) => handleReactionOptionKeyDown(e, index)}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors cursor-pointer ${
                            userReaction === emoji
                              ? 'bg-bg-secondary hover:bg-bg-tertiary'
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

                {/* Reaction counts - prominent */}
                {reactions.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {reactions.map(({ emoji, count }) => (
                      <span
                        key={emoji}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-bg-secondary text-sm"
                      >
                        <span>{emoji}</span>
                        <span className="text-text-primary font-medium">{count}</span>
                      </span>
                    ))}
                  </div>
                )}

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
                    {/* Add reaction button */}
                    <div
                      className="relative"
                      ref={reactionPickerRef}
                      onBlur={handleReactionPickerBlur}
                    >
                      <button
                        ref={reactionTriggerRef}
                        onClick={() => setShowReactionPicker(!showReactionPicker)}
                        onKeyDown={handleReactionTriggerKeyDown}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors cursor-pointer ${
                          showReactionPicker
                            ? 'bg-primary/20 text-primary'
                            : 'bg-bg-secondary hover:bg-bg-tertiary text-text-muted'
                        }`}
                        aria-label="Add reaction"
                        aria-expanded={showReactionPicker}
                        aria-haspopup="listbox"
                      >
                        {userReaction || '+'}
                      </button>

                      {/* Reaction picker dropdown */}
                      {showReactionPicker && (
                        <div
                          role="listbox"
                          aria-label="Select reaction"
                          className="absolute left-0 bottom-full mb-1 z-[60] bg-surface border border-border rounded-lg shadow-elevated p-1.5 flex gap-1"
                        >
                          {EMOJI_OPTIONS.map((emoji, index) => (
                            <button
                              key={emoji}
                              ref={(el) => {
                                reactionOptionRefs.current[index] = el;
                              }}
                              role="option"
                              aria-selected={userReaction === emoji}
                              onClick={() => {
                                handleReactionClick(emoji);
                                setShowReactionPicker(false);
                                reactionTriggerRef.current?.focus();
                              }}
                              onKeyDown={(e) => handleReactionOptionKeyDown(e, index)}
                              className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors cursor-pointer ${
                                userReaction === emoji
                                  ? 'bg-bg-secondary hover:bg-bg-tertiary'
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

                    {/* Reaction summary with popover trigger - prominent */}
                    {reactions.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => loadReactionDetails()}
                          className="flex gap-1.5 flex-wrap cursor-pointer"
                        >
                          {reactions.map(({ emoji, count }) => (
                            <span
                              key={emoji}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-bg-secondary text-sm"
                            >
                              <span>{emoji}</span>
                              <span className="text-text-primary font-medium">{count}</span>
                            </span>
                          ))}
                        </button>

                        {/* Reaction details popover */}
                        {showReactionPopover && Object.keys(reactionsByEmoji).length > 0 && (
                          <div
                            ref={reactionPopoverRef}
                            className="absolute left-0 bottom-full mb-1 z-[60] bg-surface border border-border rounded-lg shadow-elevated p-2 min-w-[200px] max-w-sm"
                          >
                            <button
                              onClick={() => setShowReactionPopover(false)}
                              className="absolute top-1 right-1 text-text-muted hover:text-text-primary cursor-pointer"
                              aria-label="Close"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                            {Object.entries(reactionsByEmoji).map(([emoji, names]) => (
                              <div key={emoji} className="text-sm py-1">
                                <span className="mr-2">{emoji}</span>
                                <span className="text-text-secondary">{names.join(', ')}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Collapse button - pushed to right */}
                    <button
                      ref={hideCommentsButtonRef}
                      onClick={handleHideComments}
                      className="ml-auto px-3 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-secondary text-sm cursor-pointer"
                      title="Hide comments"
                    >
                      Hide comments
                    </button>
                  </div>
                </div>

                {/* Comments section */}
                <div className="flex-1 overflow-y-auto p-3 min-h-0">
                  {loadingComments ? (
                    <div className="flex justify-center py-4">
                      <div className="spinner-sm" />
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-4">No comments yet</p>
                  ) : (
                    <div className="space-y-3">
                      {comments.map((comment) => (
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
