import { useState, useRef } from 'react';
import { api } from '../lib/api';
import { compressImage, validateImageFile, formatFileSize } from '../lib/imageCompression';

interface PhotoUploadProps {
  onUploadComplete?: () => void;
}

export function PhotoUpload({ onUploadComplete }: PhotoUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setSelectedFile(file);
    setError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);
    setProgress('Compressing images...');

    try {
      setCompressing(true);
      const { fullSize, thumbnail } = await compressImage(selectedFile);
      setCompressing(false);

      setProgress(
        `Uploading (${formatFileSize(fullSize.size)} + ${formatFileSize(thumbnail.size)})...`
      );

      await api.photos.upload(fullSize, thumbnail, caption || undefined);

      setProgress('Upload complete!');
      setSelectedFile(null);
      setCaption('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setTimeout(() => {
        setProgress('');
        onUploadComplete?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress('');
    } finally {
      setUploading(false);
      setCompressing(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setCaption('');
    setError(null);
    setProgress('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="card">
      <h2 className="text-2xl font-bold text-neutral-800 mb-6">Upload a photo</h2>

      <div className="space-y-6">
        <div>
          <label htmlFor="photo-input" className="block text-sm font-medium text-neutral-700 mb-2">
            Select photo
          </label>
          <input
            id="photo-input"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={uploading}
            aria-describedby={selectedFile ? 'selected-file-info' : undefined}
            className="block w-full text-sm text-neutral-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {selectedFile && (
            <p id="selected-file-info" className="mt-2 text-sm text-neutral-600">
              Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
            </p>
          )}
        </div>

        {selectedFile && (
          <div>
            <label htmlFor="caption" className="block text-sm font-medium text-neutral-700 mb-2">
              Caption (optional)
            </label>
            <textarea
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={uploading}
              rows={3}
              className="block w-full px-4 py-3 border-2 border-neutral-300 rounded-lg text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-100 focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Add a caption..."
            />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-4 bg-red-50 border-2 border-red-200 rounded-lg text-sm text-red-700 font-medium"
          >
            {error}
          </div>
        )}

        {progress && (
          <div
            role="status"
            aria-live="polite"
            className="p-4 bg-primary-50 border-2 border-primary-200 rounded-lg text-sm text-primary-700 font-medium"
          >
            {progress}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || compressing}
            className="btn-primary flex-1"
            aria-label={
              compressing ? 'Compressing image' : uploading ? 'Uploading photo' : 'Upload photo'
            }
          >
            {compressing ? 'Compressing...' : uploading ? 'Uploading...' : 'Upload'}
          </button>

          {selectedFile && !uploading && (
            <button onClick={handleCancel} className="btn-secondary" aria-label="Cancel upload">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
