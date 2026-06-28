import { useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import {
  compressImage,
  convertHeicToJpeg,
  isHeicFile,
  validateImageFile,
  formatFileSize,
} from '../lib/imageCompression';
import { Button } from './Button';

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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setError(null);
    setPreviewLoading(true);

    // Convert HEIC files to JPEG upfront — browsers can't display or compress HEIC natively.
    // We store the converted file as selectedFile so compressImage doesn't re-convert.
    let processedFile = file;
    if (isHeicFile(file)) {
      try {
        processedFile = await convertHeicToJpeg(file);
      } catch (err) {
        console.error('HEIC conversion failed:', err);
        setError('Could not process HEIC file. Please try a different image.');
        setPreviewLoading(false);
        return;
      }
    }

    setSelectedFile(processedFile);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
      setPreviewLoading(false);
    };
    reader.onerror = () => {
      setError('Failed to generate image preview');
      setPreviewLoading(false);
    };
    reader.readAsDataURL(processedFile);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file).catch((err) => {
        console.error('Unexpected error handling file:', err);
        setError('Failed to process file');
      });
    }
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
            {previewLoading || !preview ? (
              <div className="w-full rounded-lg bg-bg-secondary max-h-60 min-h-[200px] animate-pulse" />
            ) : (
              <img
                src={preview}
                alt="Preview"
                className="w-full rounded-lg bg-bg-secondary max-h-60 object-contain"
              />
            )}
            {!uploading && (
              <button
                onClick={handleCancel}
                aria-label="Cancel upload"
                className="absolute top-2 right-2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white cursor-pointer"
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
              maxLength={2000}
              className="input-field resize-none"
              placeholder="Add a caption..."
            />
            {Array.from(caption).length > 1900 && (
              <p className="text-xs text-text-muted mt-1">{Array.from(caption).length}/2000</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}

          {progress && <p className="text-sm text-text-secondary">{progress}</p>}

          <Button onClick={handleUpload} size="lg" disabled={uploading} className="w-full">
            {uploading ? (
              <span className="flex items-center gap-2">
                <span className="spinner spinner-sm" />
                {progress || 'Uploading...'}
              </span>
            ) : (
              'Upload'
            )}
          </Button>
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
