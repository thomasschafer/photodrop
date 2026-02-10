import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api';
import { getNavDirection, isHorizontalNavKey } from '../../lib/keyboard';
import { useDropdown } from '../../lib/useDropdown';
import { useIsPortrait } from '../../lib/useIsPortrait';
import { useVirtualCarousel } from '../../lib/useVirtualCarousel';
import { useAuthenticatedImage, preloadImage } from '../../lib/useAuthenticatedImage';
import { ProtectedImage } from '../ProtectedImage';
import { ConfirmModal } from '../ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { CommentPanel } from './CommentPanel';
import type { Photo, Comment, ReactionSummary, ReactionWithUser } from './types';
import { EMOJI_OPTIONS } from './types';

function ProgressiveImage({ photoId, alt }: { photoId: string; alt: string }) {
  const { imageProtection } = useAuth();
  const thumbnail = useAuthenticatedImage(photoId, 'thumbnail');
  const full = useAuthenticatedImage(photoId, 'download');

  const showThumbnail = !full.src || full.loading;

  return (
    <div className="relative w-full h-full">
      {thumbnail.src && (
        <ProtectedImage
          protected={imageProtection}
          src={thumbnail.src}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-contain rounded-lg transition-opacity duration-300 ${
            showThumbnail ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {full.src && (
        <ProtectedImage
          protected={imageProtection}
          src={full.src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-contain rounded-lg transition-opacity duration-300 opacity-100"
        />
      )}
      {thumbnail.loading && !thumbnail.src && (
        <div className="absolute inset-0 animate-pulse bg-bg-secondary rounded-lg" />
      )}
    </div>
  );
}

export function Lightbox({
  photos,
  initialIndex,
  onClose,
  onIndexChange,
  isAdmin,
  onPhotoUpdate,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  isAdmin: boolean;
  onPhotoUpdate: (photo: Partial<Photo> & { id: string }) => void;
}) {
  const { user } = useAuth();

  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const isPortrait = useIsPortrait();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const commentsPanelRef = useRef<HTMLDivElement>(null);
  const carouselContainerRef = useRef<HTMLDivElement>(null);

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

  const photo = photos[centerIndex];
  const prevPhoto = centerIndex > 0 ? photos[centerIndex - 1] : undefined;
  const nextPhoto = centerIndex < photos.length - 1 ? photos[centerIndex + 1] : undefined;

  const [userReaction, setUserReaction] = useState<string | null>(photo.userReaction);
  const [reactions, setReactions] = useState<ReactionSummary[]>(photo.reactions);
  const [reactionDetails, setReactionDetails] = useState<ReactionWithUser[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const loadingReactionDetailsRef = useRef(false);

  const currentReactionIndex = userReaction ? EMOJI_OPTIONS.indexOf(userReaction) : 0;
  const {
    containerRef: reactionPickerRef,
    triggerRef: reactionTriggerRef,
    setOptionRef: reactionSetOptionRef,
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

  const commentsCache = useRef<Map<string, Comment[]>>(new Map());
  const reactionDetailsCache = useRef<Map<string, ReactionWithUser[]>>(new Map());

  useLayoutEffect(() => {
    if (initialIndex !== centerIndex) {
      resetCarousel(initialIndex);
    }
  }, [initialIndex, centerIndex, resetCarousel]);

  useLayoutEffect(() => {
    setUserReaction(photo.userReaction);
    setReactions(photo.reactions);
    setShowReactionPicker(false);
    setNewComment('');

    const cachedComments = commentsCache.current.get(photo.id);
    const cachedReactionDetails = reactionDetailsCache.current.get(photo.id);
    setComments(cachedComments ?? []);
    setReactionDetails(cachedReactionDetails ?? []);
    // Reset only on photo change, not on optimistic reaction updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const prevPhotoId = prevPhoto?.id;
  const nextPhotoId = nextPhoto?.id;

  useEffect(() => {
    if (nextPhotoId) {
      preloadImage(nextPhotoId, 'download');
      preloadImage(nextPhotoId, 'thumbnail');
    }
    if (prevPhotoId) {
      preloadImage(prevPhotoId, 'download');
      preloadImage(prevPhotoId, 'thumbnail');
    }
  }, [nextPhotoId, prevPhotoId]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

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

  useEffect(() => {
    let stale = false;
    const photoId = photo.id;

    if (commentsCache.current.has(photoId)) return;

    setLoadingComments(true);
    (async () => {
      try {
        const data = await api.photos.getComments(photoId);
        if (stale) return;
        setComments(data.comments);
        commentsCache.current.set(photoId, data.comments);
      } catch (err) {
        if (stale) return;
        console.error('Failed to load comments:', err);
      } finally {
        if (!stale) setLoadingComments(false);
      }
    })();

    return () => {
      stale = true;
    };
  }, [photo.id]);

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

    if (prevPhotoId) preloadComments(prevPhotoId);
    if (nextPhotoId) preloadComments(nextPhotoId);
  }, [prevPhotoId, nextPhotoId]);

  const loadReactionDetails = useCallback(async () => {
    if (loadingReactionDetailsRef.current) return;

    const cached = reactionDetailsCache.current.get(photo.id);
    if (cached) {
      setReactionDetails(cached);
      return;
    }

    loadingReactionDetailsRef.current = true;
    try {
      const data = await api.photos.getReactions(photo.id);
      setReactionDetails(data.reactions);
      reactionDetailsCache.current.set(photo.id, data.reactions);
    } catch (err) {
      console.error('Failed to load reaction details:', err);
    } finally {
      loadingReactionDetailsRef.current = false;
    }
  }, [photo.id]);

  useEffect(() => {
    if (reactions.length > 0) {
      loadReactionDetails();
    }
  }, [reactions.length, loadReactionDetails]);

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

    if (prevPhotoId) preloadReactionDetails(prevPhotoId, (prevPhoto?.reactions.length ?? 0) > 0);
    if (nextPhotoId) preloadReactionDetails(nextPhotoId, (nextPhoto?.reactions.length ?? 0) > 0);
    // prevPhoto/nextPhoto accessed only for .reactions.length which is stable per photo identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevPhotoId, nextPhotoId]);

  const handleReactionClick = async (emoji: string) => {
    if (!user) return;

    const previousReaction = userReaction;
    const previousReactions = reactions;
    const previousDetails = reactionDetails;

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

    setUserReaction(newUserReaction);
    setReactions(newReactions);

    let newDetails = reactionDetails.filter((r) => r.userId !== user.id);
    if (!isRemoving) {
      newDetails = [
        ...newDetails,
        { emoji, userId: user.id, userName: user.name, profileColor: user.profileColor },
      ];
    }
    setReactionDetails(newDetails);
    reactionDetailsCache.current.set(photo.id, newDetails);

    try {
      if (isRemoving) {
        await api.photos.removeReaction(photo.id);
      } else {
        await api.photos.addReaction(photo.id, emoji);
      }
      onPhotoUpdate({
        id: photo.id,
        userReaction: newUserReaction,
        reactions: newReactions,
      });
    } catch (err) {
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
        authorProfileColor: user?.profileColor ?? null,
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
        const updated = prev.map((c) =>
          c.id === confirmDeleteCommentId
            ? { ...c, isDeleted: true, content: '[deleted]', userId: null }
            : c
        );
        commentsCache.current.set(photo.id, updated);
        return updated;
      });
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
      if (document.activeElement === commentInputRef.current) {
        if (e.key === 'Escape') {
          commentInputRef.current?.blur();
        }
        return;
      }

      if (showReactionPicker) return;

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
      <div className="h-full w-full flex flex-col landscape:flex-row">
        <div
          onClick={onClose}
          className={`relative min-h-0 landscape:min-w-0 overflow-hidden flex-1 ${
            commentsExpanded ? 'h-[55%] landscape:h-full' : ''
          }`}
        >
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2-safe right-4 z-10 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer flex items-center justify-center text-white transition-colors hover:bg-white/20"
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
                      photoId={slidePhoto.id}
                      alt={slidePhoto.caption || `Photo ${photoIndex + 1}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div
          ref={commentsPanelRef}
          onClick={(e) => e.stopPropagation()}
          className={`p-2 pt-0 pb-2-safe landscape:pt-2 landscape:pl-0 flex-shrink-0 ${
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
              setOptionRef: reactionSetOptionRef,
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
