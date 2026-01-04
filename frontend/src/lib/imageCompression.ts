import imageCompression from 'browser-image-compression';

export interface CompressionResult {
  fullSize: File;
  thumbnail: File;
}

export async function compressImage(file: File): Promise<CompressionResult> {
  const fullSizeOptions = {
    maxSizeMB: 2,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
  };

  const thumbnailOptions = {
    maxSizeMB: 0.05,
    maxWidthOrHeight: 400,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
  };

  const [fullSize, thumbnail] = await Promise.all([
    imageCompression(file, fullSizeOptions),
    imageCompression(file, thumbnailOptions),
  ]);

  const fullSizeFile = new File([fullSize], `photo-${Date.now()}.jpg`, {
    type: 'image/jpeg',
  });

  const thumbnailFile = new File([thumbnail], `thumbnail-${Date.now()}.jpg`, {
    type: 'image/jpeg',
  });

  return {
    fullSize: fullSizeFile,
    thumbnail: thumbnailFile,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!isImageFile(file)) {
    return {
      valid: false,
      error: 'File must be an image',
    };
  }

  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'File size must be less than 50MB',
    };
  }

  return { valid: true };
}
