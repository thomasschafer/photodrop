import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { formatRelativeTime } from '../lib/dateFormat';
import { useFocusRestore } from '../lib/hooks';
import { getNavDirection } from '../lib/keyboard';
import { useAuthenticatedImage } from '../lib/useAuthenticatedImage';
import { PullToRefresh } from './PullToRefresh';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { PhotoUpload } from './PhotoUpload';
import { ProtectedImage } from './ProtectedImage';
import { useAuth } from '../contexts/AuthContext';
import {
  ReactionPills,
  Lightbox,
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

export function PhotoFeed({ isAdmin = false }: PhotoFeedProps) {
  const { user, imageProtection: imageProtectionEnabled } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const deleteButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const photoRefs = useRef<(HTMLElement | null)[]>([]);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { photoId } = useParams<{ photoId: string }>();

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

  const loadPhotos = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.photos.list(20, 0);
      setPhotos(data.photos);
      setHasMore(data.hasMore ?? false);
      setFeedReactionDetails(new Map());
      reactionsEngine.resetCache();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  };

  const loadMorePhotos = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    try {
      setLoadingMore(true);
      const data = await api.photos.list(20, photos.length);
      setPhotos((prev) => [...prev, ...data.photos]);
      setHasMore(data.hasMore ?? false);
    } catch (err) {
      console.error('Failed to load more photos:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, photos.length]);

  useEffect(() => {
    loadPhotos();
  }, []);

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          loadMorePhotos();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMorePhotos]);

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
      { id: user.id, name: user.name, profileColor: user.profileColor },
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
        onRollback: ({ reactions, userReactions, details }) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === photoId ? { ...p, userReactions, reactions } : p))
          );
          setPhotoReactionDetails(photoId, details);
        },
        onDetailsRefreshed: (details) => setPhotoReactionDetails(photoId, details),
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
      <PullToRefresh onRefresh={loadPhotos} className="max-w-[540px] mx-auto">
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
        <div className="flex flex-col gap-6" role="list" aria-label="Photo feed">
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
          </div>
        )}
      </PullToRefresh>

      {selectedPhoto && selectedPhotoIndex !== null && selectedPhotoIndex >= 0 && (
        <Lightbox
          photos={photos}
          initialIndex={selectedPhotoIndex}
          onClose={handleLightboxClose}
          onIndexChange={(index) => {
            navigate(`/photo/${photos[index].id}${location.search}`, { replace: true });
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
