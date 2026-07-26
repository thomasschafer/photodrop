import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getNavDirection } from '../../lib/keyboard';
import { useIsPortrait } from '../../lib/useIsPortrait';
import { useVirtualCarousel } from '../../lib/useVirtualCarousel';
import { useAuthenticatedImage, preloadImage } from '../../lib/useAuthenticatedImage';
import { ProtectedImage } from '../ProtectedImage';
import { ConfirmModal } from '../ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { CommentPanel } from './CommentPanel';
import { UploaderByline } from './UploaderByline';
import type { Photo } from './types';
import { useLightboxReactions } from './useLightboxReactions';
import { useLightboxComments } from './useLightboxComments';

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

  const [searchParams, setSearchParams] = useSearchParams();
  const commentsExpanded = searchParams.get('comments') === 'open';
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

  const { userReactions, reactions, reactionDetails, loadReactionDetails, handleReactionClick } =
    useLightboxReactions({ photo, prevPhoto, nextPhoto, user, onPhotoUpdate });

  const {
    comments,
    loadingComments,
    commentsLoadError,
    retryLoadComments,
    newComment,
    setNewComment,
    submittingComment,
    commentError,
    submitComment,
    postedCommentId,
    deletingCommentId,
    confirmDeleteCommentId,
    deleteCommentError,
    requestDeleteComment,
    confirmDeleteComment,
    cancelDeleteComment,
  } = useLightboxComments({ photo, prevPhoto, nextPhoto, user, onPhotoUpdate });

  const [commentSortOrder, setCommentSortOrder] = useState<'newest' | 'oldest'>('oldest');

  useLayoutEffect(() => {
    if (initialIndex !== centerIndex) {
      resetCarousel(initialIndex);
    }
  }, [initialIndex, centerIndex, resetCarousel]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === commentInputRef.current) {
        if (e.key === 'Escape') {
          commentInputRef.current?.blur();
        }
        return;
      }

      // Let an open in-panel menu/picker (reaction picker, sort dropdown) handle
      // its own arrow/escape keys instead of navigating photos.
      if ((document.activeElement as Element | null)?.closest('[role="listbox"]')) return;

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
  }, [onClose, onIndexChange, centerIndex, photos.length]);

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
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2-safe left-4 z-10 max-w-[calc(100%-4rem)]"
          >
            <UploaderByline
              name={photo.uploaderName}
              color={photo.uploaderProfileColor}
              uploadedAt={photo.uploadedAt}
              variant="overlay"
            />
          </div>

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
            userReactions={userReactions}
            comments={comments}
            highlightedCommentId={postedCommentId}
            commentCount={photo.commentCount}
            commentsExpanded={commentsExpanded}
            currentUserId={user?.id}
            isAdmin={isAdmin}
            reactionsKey={photo.id}
            reactionPillsProps={{
              onReactionClick: handleReactionClick,
              pickerPosition: isPortrait ? 'above' : 'below',
              useViewportPositioning: isPortrait,
              reactionDetails: reactionDetails,
              onLoadReactionDetails: loadReactionDetails,
              currentUserId: user?.id,
              showNames: true,
            }}
            commentSortOrder={commentSortOrder}
            onSortOrderChange={setCommentSortOrder}
            onToggleExpanded={() => {
              setSearchParams(
                (prev) => {
                  if (commentsExpanded) {
                    prev.delete('comments');
                  } else {
                    prev.set('comments', 'open');
                  }
                  return prev;
                },
                { replace: true }
              );
            }}
            onDeleteComment={requestDeleteComment}
            deletingCommentId={deletingCommentId}
            loadingComments={loadingComments}
            commentsLoadError={commentsLoadError}
            onRetryLoadComments={retryLoadComments}
            commentInputRef={commentInputRef}
            newComment={newComment}
            onNewCommentChange={setNewComment}
            onSubmitComment={submitComment}
            submittingComment={submittingComment}
            commentError={commentError}
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
          onConfirm={confirmDeleteComment}
          onCancel={cancelDeleteComment}
        />
      )}
    </div>
  );
}
