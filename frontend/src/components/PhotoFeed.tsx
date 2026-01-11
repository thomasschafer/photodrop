import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api, API_BASE_URL } from '../lib/api';
import { getNavDirection } from '../lib/keyboard';
import { ConfirmModal } from './ConfirmModal';

function useAuthToken() {
  return useMemo(() => localStorage.getItem('accessToken') || '', []);
}

interface Photo {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
}

interface PhotoFeedProps {
  isAdmin?: boolean;
}

export function PhotoFeed({ isAdmin = false }: PhotoFeedProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const token = useAuthToken();
  const photoRefs = useRef<(HTMLElement | null)[]>([]);

  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;

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

  const focusPhoto = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, photos.length - 1));
      photoRefs.current[clampedIndex]?.focus();
    },
    [photos.length]
  );

  const handlePhotoKeyDown = (e: React.KeyboardEvent, index: number) => {
    const direction = getNavDirection(e.key);
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
        setSelectedPhotoIndex(index);
      }
    }
  };

  const handleLightboxNav = useCallback(
    (direction: 'prev' | 'next') => {
      if (selectedPhotoIndex === null) return;
      const newIndex =
        direction === 'next'
          ? Math.min(selectedPhotoIndex + 1, photos.length - 1)
          : Math.max(selectedPhotoIndex - 1, 0);
      setSelectedPhotoIndex(newIndex);
    },
    [selectedPhotoIndex, photos.length]
  );

  const handleLightboxClose = useCallback(() => {
    const indexToFocus = selectedPhotoIndex;
    setSelectedPhotoIndex(null);
    if (indexToFocus !== null) {
      setTimeout(() => focusPhoto(indexToFocus), 0);
    }
  }, [selectedPhotoIndex, focusPhoto]);

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
      <div className="text-center py-16">
        <p className="text-text-secondary mb-2">No photos yet</p>
        <p className="text-sm text-text-muted">
          {isAdmin
            ? 'Upload your first photo to get started.'
            : 'Photos will appear here once they are uploaded.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[540px] mx-auto">
        <div className="flex flex-col gap-6" role="list" aria-label="Photo feed">
          {photos.map((photo, index) => (
            <article
              key={photo.id}
              ref={(el) => {
                photoRefs.current[index] = el;
              }}
              onClick={() => setSelectedPhotoIndex(index)}
              onKeyDown={(e) => handlePhotoKeyDown(e, index)}
              tabIndex={0}
              role="listitem"
              aria-label={photo.caption || `Photo ${index + 1}`}
              className="cursor-pointer bg-surface rounded-xl overflow-hidden border border-border shadow-card transition-shadow hover:shadow-elevated"
            >
              <div className="relative bg-bg-secondary">
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
                <div className="flex justify-between items-center">
                  <p className="text-xs text-text-muted">{formatDate(photo.uploadedAt)}</p>
                  {isAdmin && (
                    <button
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

      {selectedPhoto && selectedPhotoIndex !== null && (
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
          onCancel={() => {
            setConfirmDelete(null);
            setDeleteError(null);
          }}
        />
      )}
    </>
  );
}

function Lightbox({
  photo,
  token,
  onClose,
  onPrev,
  onNext,
  currentIndex,
  totalCount,
}: {
  photo: Photo;
  token: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  currentIndex: number;
  totalCount: number;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const direction = getNavDirection(e.key);
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
  }, [onClose, onPrev, onNext]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 touch-none"
      role="dialog"
      aria-label={`Photo ${currentIndex + 1} of ${totalCount}`}
    >
      <button
        ref={closeButtonRef}
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 border-none cursor-pointer flex items-center justify-center text-white transition-colors hover:bg-white/20"
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

      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-2 md:mx-16 max-w-[98vw] md:max-w-[90vw] max-h-[90vh]"
      >
        <img
          src={`${API_BASE_URL}/photos/${photo.id}/download?token=${token}`}
          alt={photo.caption || 'Photo'}
          className="max-w-full max-h-[90vh] object-contain rounded-lg"
        />
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
        {currentIndex + 1} / {totalCount}
      </div>
    </div>
  );
}
