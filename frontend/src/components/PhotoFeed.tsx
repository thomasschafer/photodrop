import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';

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
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const token = useAuthToken();

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedPhoto) {
        setSelectedPhoto(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhoto]);

  const handleDelete = async (photoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this photo?')) {
      return;
    }
    setDeleting(photoId);
    try {
      await api.photos.delete(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      alert('Failed to delete photo');
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
        <p className="text-neutral-600 mb-4">{error}</p>
        <button onClick={loadPhotos} className="btn-primary">
          Try again
        </button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-16">
        <p style={{ color: '#6b635b', marginBottom: '0.5rem' }}>No photos yet</p>
        <p style={{ fontSize: '0.875rem', color: '#8a8078' }}>
          Upload your first photo to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ maxWidth: '540px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {photos.map((photo) => (
            <article
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedPhoto(photo);
                }
              }}
              tabIndex={0}
              role="button"
              style={{
                cursor: 'pointer',
                backgroundColor: 'white',
                borderRadius: '0.75rem',
                overflow: 'hidden',
                border: '1px solid #f0ebe6',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div style={{ position: 'relative', backgroundColor: '#f5f4f1' }}>
                <img
                  src={`/api/photos/${photo.id}/thumbnail?token=${token}`}
                  alt={photo.caption || ''}
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    maxHeight: '400px',
                    objectFit: 'cover',
                  }}
                  loading="lazy"
                />
              </div>
              <div style={{ padding: '1rem 1.25rem' }}>
                {photo.caption && (
                  <p style={{ color: '#3a3632', marginBottom: '0.5rem', lineHeight: 1.5 }}>
                    {photo.caption}
                  </p>
                )}
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <p style={{ fontSize: '0.75rem', color: '#b8afa5', margin: 0 }}>
                    {formatDate(photo.uploadedAt)}
                  </p>
                  {isAdmin && (
                    <button
                      onClick={(e) => handleDelete(photo.id, e)}
                      disabled={deleting === photo.id}
                      style={{
                        fontSize: '0.75rem',
                        color: '#c45454',
                        background: 'none',
                        border: 'none',
                        cursor: deleting === photo.id ? 'not-allowed' : 'pointer',
                        opacity: deleting === photo.id ? 0.5 : 1,
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                      }}
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

      {selectedPhoto && (
        <Lightbox photo={selectedPhoto} token={token} onClose={() => setSelectedPhoto(null)} />
      )}
    </>
  );
}

function Lightbox({ photo, token, onClose }: { photo: Photo; token: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          width: '2.5rem',
          height: '2.5rem',
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
        }}
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

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ margin: '0 1rem', maxWidth: '896px', maxHeight: '90vh' }}
      >
        <img
          src={`/api/photos/${photo.id}/download?token=${token}`}
          alt={photo.caption || 'Photo'}
          style={{
            maxWidth: '100%',
            maxHeight: '90vh',
            objectFit: 'contain',
            borderRadius: '0.5rem',
          }}
        />
      </div>
    </div>
  );
}
