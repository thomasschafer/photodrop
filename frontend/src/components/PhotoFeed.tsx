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
      <div className="flex justify-center py-12">
        <div className="text-gray-500">Loading photos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        {error}
        <button
          onClick={loadPhotos}
          className="ml-4 text-sm underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No photos yet. Upload the first one!
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="bg-white rounded-lg shadow overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => setSelectedPhoto(photo.id)}
          >
            <div className="aspect-square bg-gray-100 flex items-center justify-center">
              <img
                src={`/api/photos/${photo.id}/thumbnail`}
                alt={photo.caption || 'Photo'}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3EPhoto%3C/text%3E%3C/svg%3E';
                }}
              />
            </div>
            <div className="p-4">
              {photo.caption && (
                <p className="text-sm text-gray-900 mb-2">{photo.caption}</p>
              )}
              <p className="text-xs text-gray-500">{formatDate(photo.uploadedAt)}</p>
            </div>
          </div>
        ))}
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="max-w-4xl max-h-full">
            <img
              src={`/api/photos/${selectedPhoto}/download`}
              alt="Full size photo"
              className="max-w-full max-h-screen object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
