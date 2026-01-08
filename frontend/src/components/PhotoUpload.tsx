import { useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { compressImage, validateImageFile, formatFileSize } from '../lib/imageCompression';

interface PhotoUploadProps {
  onUploadComplete?: () => void;
}

export function PhotoUpload({ onUploadComplete }: PhotoUploadProps) {
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

  return (
    <div style={{ maxWidth: '480px' }}>
      <div className="card">
        <h2 className="text-lg font-medium text-neutral-800 mb-4">Upload photo</h2>

        {!selectedFile ? (
          <div>
            <input
              id="photo-input"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploading}
              className="block w-full text-sm text-neutral-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-neutral-100 file:text-neutral-700 hover:file:bg-neutral-200"
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <img
                src={preview || ''}
                alt="Preview"
                className="w-full rounded-lg bg-neutral-100"
                style={{ maxHeight: '240px', objectFit: 'contain' }}
              />
              {!uploading && (
                <button
                  onClick={handleCancel}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white"
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

            <p className="text-sm text-neutral-500">
              {selectedFile.name} ({formatFileSize(selectedFile.size)})
            </p>

            <div>
              <label
                htmlFor="caption"
                className="block text-sm font-medium text-neutral-700 mb-1.5"
              >
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
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            {progress && <p className="text-sm text-neutral-500">{progress}</p>}

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
      </div>
    </div>
  );
}
