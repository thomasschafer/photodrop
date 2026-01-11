import { useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { compressImage, validateImageFile, formatFileSize } from '../lib/imageCompression';

interface PhotoUploadProps {
  onUploadComplete?: () => void;
  isModal?: boolean;
}

export function PhotoUpload({ onUploadComplete, isModal = false }: PhotoUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setSelectedFile(file);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setProgress('Compressing...');

    try {
      const { fullSize, thumbnail } = await compressImage(selectedFile);
      setProgress('Uploading...');
      await api.photos.upload(fullSize, thumbnail, caption || undefined);

      setProgress('');
      setSelectedFile(null);
      setPreview(null);
      setCaption('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onUploadComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress('');
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setPreview(null);
    setCaption('');
    setError(null);
    setProgress('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadContent = (
    <>
      {!isModal && <h2 className="text-lg font-medium text-text-primary mb-4">Upload photo</h2>}

      {!selectedFile ? (
        <div>
          <input
            id="photo-input"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={uploading}
            className="file-input"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <img
              src={preview || ''}
              alt="Preview"
              className="w-full rounded-lg bg-bg-secondary max-h-60 object-contain"
            />
            {!uploading && (
              <button
                onClick={handleCancel}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white cursor-pointer"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          <p className="text-sm text-text-secondary">
            {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </p>

          <div>
            <label htmlFor="caption" className="block text-sm font-medium text-text-primary mb-1.5">
              Caption (optional)
            </label>
            <textarea
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={uploading}
              rows={2}
              className="input-field resize-none"
              placeholder="Add a caption..."
            />
          </div>

          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}

          {progress && <p className="text-sm text-text-secondary">{progress}</p>}

          <button onClick={handleUpload} disabled={uploading} className="btn-primary w-full">
            {uploading ? (
              <span className="flex items-center gap-2">
                <span className="spinner spinner-sm" />
                {progress || 'Uploading...'}
              </span>
            ) : (
              'Upload'
            )}
          </button>
        </div>
      )}
    </>
  );

  if (isModal) {
    return uploadContent;
  }

  return (
    <div className="max-w-[480px] mx-auto">
      <div className="card">{uploadContent}</div>
    </div>
  );
}
