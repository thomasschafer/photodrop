import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Lightbox, type Photo } from '../components/photo-feed';

interface LocationState {
  photos: Photo[];
  photoIndex: number;
}

function isLocationState(state: unknown): state is LocationState {
  if (typeof state !== 'object' || state === null) return false;
  const s = state as Record<string, unknown>;
  return Array.isArray(s.photos) && typeof s.photoIndex === 'number';
}

export function LightboxPage() {
  const { photoId } = useParams<{ photoId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, currentGroup } = useAuth();

  const isAdmin = currentGroup?.role === 'admin';
  const locationState = isLocationState(location.state) ? location.state : null;

  const [photos, setPhotos] = useState<Photo[] | null>(locationState?.photos ?? null);
  const [loading, setLoading] = useState(!locationState);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!user || !currentGroup) {
      navigate('/', { replace: true });
    }
  }, [user, currentGroup, navigate]);

  // Fetch photos when opened via direct link / refresh (no router state)
  useEffect(() => {
    if (locationState) return;

    let stale = false;

    (async () => {
      try {
        const data = await api.photos.list(200, 0);
        if (stale) return;
        setPhotos(data.photos);
      } catch {
        if (stale) return;
        setError('Failed to load photos');
      } finally {
        if (!stale) setLoading(false);
      }
    })();

    return () => {
      stale = true;
    };
  }, [locationState]);

  const selectedPhotoIndex = photos?.findIndex((p) => p.id === photoId) ?? -1;

  // Redirect if photo not found after loading
  useEffect(() => {
    if (!loading && photos && selectedPhotoIndex === -1) {
      navigate('/', { replace: true });
    }
  }, [loading, photos, selectedPhotoIndex, navigate]);

  const handleClose = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const handleIndexChange = useCallback(
    (index: number) => {
      if (!photos) return;
      navigate(`/photo/${photos[index].id}`, { replace: true, state: { photos, photoIndex: index } });
    },
    [photos, navigate]
  );

  const handlePhotoUpdate = useCallback((updatedPhoto: Partial<Photo> & { id: string }) => {
    setPhotos((prev) =>
      prev?.map((p) => (p.id === updatedPhoto.id ? { ...p, ...updatedPhoto } : p)) ?? null
    );
  }, []);

  if (!user || !currentGroup) {
    return null;
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  if (error || !photos || selectedPhotoIndex === -1) {
    return null;
  }

  return (
    <Lightbox
      photos={photos}
      initialIndex={selectedPhotoIndex}
      onClose={handleClose}
      onIndexChange={handleIndexChange}
      isAdmin={isAdmin}
      onPhotoUpdate={handlePhotoUpdate}
    />
  );
}
