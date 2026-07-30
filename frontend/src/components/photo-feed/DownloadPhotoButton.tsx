import { useState } from 'react';
import { fetchImageBlob } from '../../lib/useAuthenticatedImage';

/**
 * Full-resolution download for members whose image protection is switched
 * off. Members with protection on never see this — the soft-blocking posture
 * stays as it is for them.
 */
export function DownloadPhotoButton({ photoId }: { photoId: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchImageBlob(photoId, 'download');
      const extension = blob.type.includes('png')
        ? 'png'
        : blob.type.includes('webp')
          ? 'webp'
          : 'jpg';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `photodrop-${photoId}.${extension}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Failed to download photo:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={() => void handleDownload()}
      disabled={downloading}
      aria-label="Download photo"
      className="flex items-center justify-center w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 border-none cursor-pointer text-white/90 transition-colors disabled:opacity-50"
    >
      {downloading ? (
        <span className="spinner spinner-sm" />
      ) : (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      )}
    </button>
  );
}
