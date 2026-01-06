import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface Photo {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
}

export function PhotoFeed() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

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
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <div className="text-lg text-neutral-600 font-medium">Loading photos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="p-4 bg-red-50 border-2 border-red-200 rounded-xl text-red-700 font-medium"
      >
        {error}
        <button
          onClick={loadPhotos}
          className="ml-4 text-sm font-semibold text-red-800 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2 rounded"
          aria-label="Retry loading photos"
        >
          Retry
        </button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <p className="text-lg text-neutral-600 font-medium">No photos yet.</p>
        <p className="text-neutral-500 mt-2">Upload the first one!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {photos.map((photo) => (
          <article
            key={photo.id}
            className="card cursor-pointer focus:outline-none focus:ring-4 focus:ring-primary-200 transition-all duration-200"
            onClick={() => setSelectedPhoto(photo.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedPhoto(photo.id);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`View photo${photo.caption ? `: ${photo.caption}` : ''}`}
          >
            <div className="aspect-square bg-neutral-100 rounded-lg overflow-hidden mb-4">
              <img
                src={`/api/photos/${photo.id}/thumbnail`}
                alt={photo.caption || ''}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.src =
                    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23e7e5e4" width="100" height="100"/%3E%3Ctext fill="%2378716c" x="50%25" y="50%25" text-anchor="middle" dy=".3em" font-family="Inter,sans-serif"%3EPhoto%3C/text%3E%3C/svg%3E';
                }}
              />
            </div>
            <div>
              {photo.caption && (
                <p className="text-sm text-neutral-800 mb-2 font-medium line-clamp-2">
                  {photo.caption}
                </p>
              )}
              <p className="text-xs text-neutral-500">
                <time dateTime={new Date(photo.uploadedAt * 1000).toISOString()}>
                  {formatDate(photo.uploadedAt)}
                </time>
              </p>
            </div>
          </article>
        ))}
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-neutral-900 bg-opacity-90 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedPhoto(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSelectedPhoto(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 text-white text-4xl font-light hover:text-neutral-300 focus:outline-none focus:ring-4 focus:ring-primary-200 rounded-lg px-3 py-1 transition-colors"
            aria-label="Close lightbox"
          >
            ×
          </button>
          <div className="max-w-4xl max-h-full">
            <img
              src={`/api/photos/${selectedPhoto}/download`}
              alt="Full size photo"
              className="max-w-full max-h-screen object-contain rounded-lg shadow-strong"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
