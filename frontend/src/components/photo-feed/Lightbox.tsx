import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getNavDirection } from '../../lib/keyboard';
import { useIsPortrait } from '../../lib/useIsPortrait';
import { useVirtualCarousel } from '../../lib/useVirtualCarousel';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { CAPTION_MAX_LENGTH } from '@photodrop/common/limits';
import { useAuthenticatedImage, preloadImage } from '../../lib/useAuthenticatedImage';
import { ProtectedImage } from '../ProtectedImage';
import { ConfirmModal } from '../ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { CommentPanel } from './CommentPanel';
import { DownloadPhotoButton } from './DownloadPhotoButton';
import { SeenBy } from './SeenBy';
import { UploaderByline } from './UploaderByline';
import type { OnPhotoUpdate, Photo } from './types';
import { useLightboxReactions } from './useLightboxReactions';
import { useLightboxComments } from './useLightboxComments';

// Views already recorded this app session, keyed by user so an account
// switch on the same tab records the new viewer's views too.
const recordedViews = new Set<string>();

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
  hasMorePhotos = false,
  initialIndex,
  onClose,
  onIndexChange,
  isAdmin,
  onPhotoUpdate,
}: {
  photos: Photo[];
  /** More pages exist beyond `photos`, so totals render as "N+". */
  hasMorePhotos?: boolean;
  initialIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  isAdmin: boolean;
  onPhotoUpdate: OnPhotoUpdate;
}) {
  const { user, imageProtection } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const commentsExpanded = searchParams.get('comments') === 'open';
  const isPortrait = useIsPortrait();
  const dialogRef = useRef<HTMLDivElement>(null);
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

  // Record the view that feeds the admin "Seen by" list. Best-effort: a
  // failure forgets the id so a later open retries.
  useEffect(() => {
    if (!photo || !user) return;
    const viewKey = `${user.id}:${photo.id}`;
    if (recordedViews.has(viewKey)) return;
    recordedViews.add(viewKey);
    api.photos.recordView(photo.id).catch(() => recordedViews.delete(viewKey));
  }, [photo, user]);

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

  // Inline caption editing (admins), mirroring the feed card's affordance.
  const [editingCaption, setEditingCaption] = useState<{
    value: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);

  const photoIdForCaption = photo?.id;
  useEffect(() => {
    // Whatever was being edited belongs to the photo we navigated away from.
    setEditingCaption(null);
  }, [photoIdForCaption]);

  const saveCaption = async () => {
    if (!photo || !editingCaption || editingCaption.saving) return;
    setEditingCaption({ ...editingCaption, saving: true, error: null });
    try {
      const updated = await api.photos.updateCaption(photo.id, editingCaption.value.trim() || null);
      onPhotoUpdate(photo.id, {
        caption: updated.caption,
        captionEditedAt: updated.captionEditedAt,
      });
      setEditingCaption(null);
    } catch (err) {
      setEditingCaption(
        (prev) =>
          prev && { ...prev, saving: false, error: err instanceof Error ? err.message : 'Save failed' }
      );
    }
  };

  // The confirm dialog renders inside this one and brings its own trap, so
  // ours stands down while it's open rather than fighting it for the Tab key.
  useFocusTrap(dialogRef, !confirmDeleteCommentId);

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
      // The delete-comment dialog owns the keyboard while it is open: it does
      // its own Escape and Tab handling, and neither stops propagation. Without
      // this, Escape would cancel the dialog *and* close the lightbox, and an
      // arrow key would navigate to another photo behind the dialog — leaving
      // it aimed at a comment that no longer belongs to the photo on screen.
      if (confirmDeleteCommentId) return;

      if (document.activeElement === commentInputRef.current) {
        if (e.key === 'Escape') {
          commentInputRef.current?.blur();
        }
        return;
      }

      if (document.activeElement === captionInputRef.current) {
        if (e.key === 'Escape') {
          setEditingCaption(null);
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
  }, [onClose, onIndexChange, centerIndex, photos.length, confirmDeleteCommentId]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${centerIndex + 1} of ${photos.length}${hasMorePhotos ? ' or more' : ''}`}
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
            className="absolute top-2-safe left-4 z-10 max-w-[calc(100%-4rem)] flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-2">
              <UploaderByline
                name={photo.uploaderName}
                color={photo.uploaderProfileColor}
                uploadedAt={photo.uploadedAt}
                variant="overlay"
              />
              {isAdmin && <SeenBy key={photo.id} photoId={photo.id} />}
              {!imageProtection && (
                <DownloadPhotoButton key={`dl-${photo.id}`} photoId={photo.id} />
              )}
              <span className="text-white/60 text-xs whitespace-nowrap" aria-hidden="true">
                {centerIndex + 1} of {photos.length}
                {hasMorePhotos ? '+' : ''}
              </span>
            </div>
            {editingCaption ? (
              <form
                className="flex gap-2 items-start"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveCaption();
                }}
              >
                <div className="min-w-0 w-64 max-w-[60vw]">
                  <input
                    ref={captionInputRef}
                    type="text"
                    value={editingCaption.value}
                    onChange={(e) => setEditingCaption({ ...editingCaption, value: e.target.value })}
                    disabled={editingCaption.saving}
                    maxLength={CAPTION_MAX_LENGTH}
                    aria-label="Edit caption"
                    className="input-field text-sm py-1.5"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  {editingCaption.error && (
                    <p className="text-xs text-red-400 mt-1" role="alert">
                      {editingCaption.error}
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={editingCaption.saving}
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border-none text-white text-sm cursor-pointer transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={editingCaption.saving}
                  onClick={() => setEditingCaption(null)}
                  className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/10 border-none text-white/70 text-sm cursor-pointer transition-colors"
                >
                  Cancel
                </button>
              </form>
            ) : photo.caption ? (
              <p className="text-white/90 text-sm bg-black/50 rounded-lg px-2.5 py-1 max-w-prose break-words">
                {photo.caption}
                {photo.captionEditedAt !== null && (
                  <span className="text-white/50 text-xs"> (edited)</span>
                )}
                {isAdmin && (
                  <button
                    onClick={() =>
                      setEditingCaption({ value: photo.caption ?? '', saving: false, error: null })
                    }
                    aria-label="Edit caption"
                    className="align-middle ml-1.5 p-1 -my-1 rounded bg-transparent border-none cursor-pointer text-white/60 hover:text-white transition-colors"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </p>
            ) : (
              isAdmin && (
                <button
                  onClick={() => setEditingCaption({ value: '', saving: false, error: null })}
                  className="self-start p-0 bg-transparent border-none cursor-pointer text-sm text-white/60 italic hover:text-white/90 transition-colors"
                >
                  Add a caption…
                </button>
              )
            )}
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
