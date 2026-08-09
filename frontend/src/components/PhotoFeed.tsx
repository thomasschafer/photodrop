import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useFocusRestore } from '../lib/hooks';
import { getNavDirection } from '../lib/keyboard';
import { useAuthenticatedImage } from '../lib/useAuthenticatedImage';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { PhotoUpload } from './PhotoUpload';
import { ProtectedImage } from './ProtectedImage';
import { useAuth } from '../contexts/AuthContext';
import {
  ReactionPills,
  Lightbox,
  UploaderByline,
  usePhotoReactionsEngine,
  type Photo,
  type ReactionWithUser,
} from './photo-feed';

// Grid thumbnail component that uses authenticated image loading
function GridThumbnail({
  photoId,
  alt,
  imageProtectionEnabled,
}: {
  photoId: string;
  alt: string;
  imageProtectionEnabled: boolean;
}) {
  const { src, loading } = useAuthenticatedImage(photoId, 'thumbnail');

  if (loading || !src) {
    return <div className="w-full h-auto min-h-[200px] animate-pulse bg-bg-secondary" />;
  }

  return (
    <ProtectedImage
      protected={imageProtectionEnabled}
      src={src}
      alt={alt}
      className="w-full h-auto block max-h-[400px] object-cover"
    />
  );
}

interface PhotoFeedProps {
  isAdmin?: boolean;
}

function mergePhotosNewestFirst(existing: Photo[], incoming: Photo[]): Photo[] {
  const byId = new Map(existing.map((photo) => [photo.id, photo]));
  for (const photo of incoming) byId.set(photo.id, photo);
  return [...byId.values()].sort((left, right) => {
    const newestFirst = right.uploadedAt - left.uploadedAt;
    if (newestFirst !== 0 || left.id === right.id) return newestFirst;
    // Mirror SQLite's default BINARY collation for the server's id DESC
    // tiebreaker, rather than applying the browser's current locale.
    return left.id < right.id ? 1 : -1;
  });
}

export function PhotoFeed({ isAdmin = false }: PhotoFeedProps) {
  const {
    user,
    currentGroup,
    groups,
    switchGroup,
    imageProtection: imageProtectionEnabled,
  } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [feedReactionDetails, setFeedReactionDetails] = useState<Map<string, ReactionWithUser[]>>(
    new Map()
  );
  const reactionsEngine = usePhotoReactionsEngine();
  const [uploadButtonRef, restoreUploadFocus] = useFocusRestore<HTMLButtonElement>();
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const photoRefs = useRef<(HTMLElement | null)[]>([]);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const feedListRef = useRef<HTMLDivElement>(null);
  // How many rows the server has already served us, which is what the next
  // page's offset must be. Deliberately not photos.length: duplicates are
  // dropped on the way in, so the two diverge as soon as anything is uploaded
  // mid-scroll, and paging by the kept count would re-request the same rows.
  const nextOffsetRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { photoId } = useParams<{ photoId: string }>();
  const requestedGroupId = new URLSearchParams(location.search).get('group');
  const canSwitchToRequestedGroup = Boolean(
    requestedGroupId &&
    requestedGroupId !== currentGroup?.id &&
    groups.some((group) => group.id === requestedGroupId)
  );
  const linkedPhotoRequestRef = useRef<string | null>(null);

  const loadFeedReactionDetails = useCallback(
    (photoId: string) =>
      reactionsEngine.loadDetails(photoId, (loaded) => {
        setFeedReactionDetails((prev) => new Map(prev).set(photoId, loaded));
      }),
    [reactionsEngine]
  );

  const selectedPhotoIndex = photoId ? photos.findIndex((p) => p.id === photoId) : null;
  const selectedPhoto =
    selectedPhotoIndex !== null && selectedPhotoIndex >= 0 ? photos[selectedPhotoIndex] : null;

  const loadPhotos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.photos.list(20, 0);
      setPhotos(data.photos);
      nextOffsetRef.current = data.photos.length;
      setHasMore(data.hasMore ?? false);
      setLoadMoreFailed(false);
      setFeedReactionDetails(new Map());
      reactionsEngine.resetCache();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [reactionsEngine]);

  const loadMorePhotos = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    try {
      setLoadingMore(true);
      setLoadMoreFailed(false);
      const data = await api.photos.list(20, nextOffsetRef.current);
      // Count what the server served, not what we chose to keep. Offset paging
      // over a newest-first list means an upload since the last page shifts
      // everything down and repeats rows we already hold; advancing by the
      // deduped count would ask for the same rows forever.
      nextOffsetRef.current += data.photos.length;
      // Those repeats still must not reach the list: duplicate ids collide as
      // React keys and make the lightbox's findIndex resolve to the wrong copy.
      setPhotos((prev) => {
        return mergePhotosNewestFirst(prev, data.photos);
      });
      // A page of no rows at all cannot advance the offset, so honouring a
      // hasMore that contradicts it would re-request the same empty page
      // forever. Zero rows served is the end of the feed whatever the flag
      // says. This is not the earlier mistake of counting deduped rows: a page
      // of duplicates still advances the offset and paging continues.
      setHasMore(data.photos.length > 0 && (data.hasMore ?? false));
    } catch (err) {
      console.error('Failed to load more photos:', err);
      // Nothing was appended, so the sentinel is still on screen and every
      // trigger below would fire again immediately. Stop until the user acts.
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore]);

  useEffect(() => {
    if (canSwitchToRequestedGroup && requestedGroupId) {
      setLoading(true);
      switchGroup(requestedGroupId).catch((err) => {
        console.error('Failed to open the linked group:', err);
        setError('Failed to open this photo’s group');
        setLoading(false);
      });
      return;
    }
    void loadPhotos();
  }, [canSwitchToRequestedGroup, currentGroup?.id, loadPhotos, requestedGroupId, switchGroup]);

  // Paging used to rely solely on an IntersectionObserver over the sentinel.
  // A notification it failed to deliver stranded the feed for good: nothing
  // re-asked, and once the user is at the bottom there is no further scroll to
  // trigger it again. That was reproducible on CI under WebKit, where the
  // second page was never even requested. So the sentinel is consulted
  // directly instead, from every event that can bring it into view.
  const maybeLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || loadMoreFailed) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const { top, bottom } = sentinel.getBoundingClientRect();
    if (top < window.innerHeight && bottom > 0) {
      loadMorePhotos();
    }
  }, [hasMore, loading, loadingMore, loadMoreFailed, loadMorePhotos]);

  // Re-checked after each page settles (the viewport may still not be full)
  // and on every event that can move the sentinel relative to the viewport.
  //
  // The ResizeObserver is the one that matters most, and window resize would
  // not substitute for it. Each thumbnail is a 200px placeholder until its
  // authenticated fetch resolves, then grows to as much as 400px, so a page of
  // twenty can add thousands of pixels after first paint. Scrolling to the
  // bottom of the short document leaves the sentinel visible, and then the
  // growth pushes it back below the fold with no scroll and no viewport change
  // to announce it. That is what stranded the feed at twenty photos on CI.
  //
  // It watches the list rather than the document element, which is pinned to
  // the viewport by `html, body, #root { height: 100% }` and so never reports
  // content growth at all.
  useEffect(() => {
    maybeLoadMore();

    window.addEventListener('scroll', maybeLoadMore, { passive: true });
    window.addEventListener('resize', maybeLoadMore);
    const contentObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => maybeLoadMore());
    if (feedListRef.current) {
      contentObserver?.observe(feedListRef.current);
    }

    return () => {
      window.removeEventListener('scroll', maybeLoadMore);
      window.removeEventListener('resize', maybeLoadMore);
      contentObserver?.disconnect();
    };
  }, [maybeLoadMore, photos.length]);

  useEffect(() => {
    if (loading || !photoId || selectedPhotoIndex !== -1) return;
    if (linkedPhotoRequestRef.current === photoId) return;

    let cancelled = false;
    linkedPhotoRequestRef.current = photoId;
    api.photos
      .get(photoId)
      .then((linkedPhoto) => {
        if (cancelled) return;
        setPhotos((prev) => mergePhotosNewestFirst(prev, [linkedPhoto]));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          navigate('/', { replace: true });
        } else {
          setError(err instanceof Error ? err.message : 'Failed to open photo');
        }
      })
      .finally(() => {
        if (linkedPhotoRequestRef.current === photoId) linkedPhotoRequestRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [loading, photoId, selectedPhotoIndex, navigate]);

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

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const handleUploadComplete = () => {
    setShowUploadModal(false);
    restoreUploadFocus();
    loadPhotos();
    setSuccessMessage('Photo uploaded successfully');
    // Restart the timer rather than stacking them, so a second upload within
    // 3s isn't cut short by the first upload's pending timeout.
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      successTimeoutRef.current = null;
      setSuccessMessage(null);
    }, 3000);
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

  // Details only feed the names tooltip; the summary counts live on `photos`.
  const setPhotoReactionDetails = (photoId: string, details: ReactionWithUser[] | undefined) => {
    setFeedReactionDetails((prev) => {
      const next = new Map(prev);
      if (details === undefined) {
        next.delete(photoId);
      } else {
        next.set(photoId, details);
      }
      return next;
    });
  };

  const handleFeedReactionClick = async (photoId: string, emoji: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo || !user) return;

    await reactionsEngine.toggleReactionForPhoto(
      photoId,
      {
        reactions: photo.reactions,
        userReactions: photo.userReactions,
        details: feedReactionDetails.get(photoId),
      },
      emoji,
      {
        id: user.id,
        name: currentGroup?.displayName ?? user.name,
        profileColor: user.profileColor,
      },
      {
        onOptimisticUpdate: ({ reactions, userReactions, details }) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === photoId ? { ...p, userReactions, reactions } : p))
          );
          // Update names in place when already loaded, so they stay correct
          // without a refetch.
          if (details !== undefined) {
            setPhotoReactionDetails(photoId, details);
          }
        },
        onRollback: (reconcile) => {
          // reactions/userReactions live on `photos`, details live in the
          // separate feedReactionDetails map, so the reconciler is applied to
          // each independently, reading each one's own live value via its
          // functional state update. This is safe because reconcile derives
          // reactions/userReactions/details from their own counterparts only
          // (see the doc comment on ToggleReactionCallbacks.onRollback).
          setPhotos((prev) =>
            prev.map((p) => {
              if (p.id !== photoId) return p;
              const { reactions, userReactions } = reconcile({
                reactions: p.reactions,
                userReactions: p.userReactions,
                details: undefined,
              });
              return { ...p, reactions, userReactions };
            })
          );
          setFeedReactionDetails((prev) => {
            const { details } = reconcile({
              reactions: [],
              userReactions: [],
              details: prev.get(photoId),
            });
            const next = new Map(prev);
            if (details === undefined) {
              next.delete(photoId);
            } else {
              next.set(photoId, details);
            }
            return next;
          });
        },
        onDetailsRefreshed: (details) => setPhotoReactionDetails(photoId, details),
        // Absolute, not a delta. When two toggles of the same emoji overlap
        // and one fails, only the newer may roll back, so the pair can no
        // longer be composed back to the server's answer — the engine refetches
        // it instead. This matters more here than in the lightbox: `photos` is
        // the copy the lightbox re-seeds from, so leaving it wrong spreads.
        onResync: (authoritative) => {
          setPhotos((prev) =>
            prev.map((p) =>
              p.id === photoId
                ? {
                    ...p,
                    reactions: authoritative.reactions,
                    userReactions: authoritative.userReactions,
                  }
                : p
            )
          );
          setPhotoReactionDetails(photoId, authoritative.details);
        },
      }
    );
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
        <p className="text-text-secondary mb-4" role="alert">
          {error}
        </p>
        <Button onClick={loadPhotos} size="lg">
          Try again
        </Button>
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
            <Button ref={uploadButtonRef} onClick={() => setShowUploadModal(true)} size="lg">
              Upload photo
            </Button>
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
            <Button
              ref={uploadButtonRef}
              onClick={() => setShowUploadModal(true)}
              size="sm"
              className="gap-2"
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
            </Button>
          </div>
        )}
        {successMessage && (
          <div
            className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm"
            role="status"
          >
            {successMessage}
          </div>
        )}
        <div ref={feedListRef} className="flex flex-col gap-6" role="list" aria-label="Photo feed">
          {photos.map((photo, index) => (
            <article
              key={photo.id}
              data-photo-id={photo.id}
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
                <GridThumbnail
                  photoId={photo.id}
                  alt={photo.caption || ''}
                  imageProtectionEnabled={imageProtectionEnabled}
                />
              </div>
              <div className="p-4 px-5">
                <div className="mb-2">
                  <UploaderByline
                    name={photo.uploaderName}
                    color={photo.uploaderProfileColor}
                    uploadedAt={photo.uploadedAt}
                  />
                </div>
                {photo.caption && (
                  <p className="text-text-primary mb-2 leading-normal">{photo.caption}</p>
                )}
                <div className="mb-2">
                  <ReactionPills
                    reactions={photo.reactions}
                    userReactions={photo.userReactions}
                    onReactionClick={(emoji) => handleFeedReactionClick(photo.id, emoji)}
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
                      className={`text-xs text-error bg-transparent border-none py-1 px-2 -my-2.5 rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
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
        {hasMore && (
          <div
            ref={loadMoreRef}
            className="h-16 flex items-center justify-center text-text-muted text-sm"
          >
            {loadingMore && 'Loading more photos...'}
            {loadMoreFailed && !loadingMore && (
              <span className="flex items-center gap-2">
                <span role="alert">Couldn&apos;t load more photos.</span>
                <Button onClick={loadMorePhotos} size="sm" variant="secondary">
                  Try again
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      {selectedPhoto && selectedPhotoIndex !== null && selectedPhotoIndex >= 0 && (
        <Lightbox
          photos={photos}
          initialIndex={selectedPhotoIndex}
          onClose={handleLightboxClose}
          onIndexChange={(index) => {
            navigate(`/photo/${photos[index].id}${location.search}`, { replace: true });
          }}
          isAdmin={isAdmin}
          onPhotoUpdate={(updatedPhotoId, update) => {
            setPhotos((prev) =>
              prev.map((p) =>
                p.id === updatedPhotoId
                  ? { ...p, ...(typeof update === 'function' ? update(p) : update) }
                  : p
              )
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
