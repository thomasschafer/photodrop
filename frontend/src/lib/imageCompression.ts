export interface CompressionResult {
  fullSize: File;
  thumbnail: File;
}

/**
 * Check if file is HEIC format
 */
export function isHeicFile(file: File): boolean {
  const heicTypes = ['image/heic', 'image/heif'];
  if (heicTypes.includes(file.type.toLowerCase())) return true;
  // Also check extension for files with incorrect MIME type
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'heic' || ext === 'heif';
}

/**
 * Convert HEIC file to JPEG
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any');
  const blob = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 1, // Max quality - will be compressed again by imageCompression
  });

  // heic2any can return a single blob or array
  const resultBlob = Array.isArray(blob) ? blob[0] : blob;

  if (!resultBlob) {
    throw new Error('HEIC conversion failed: no output blob');
  }

  return new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
    type: 'image/jpeg',
  });
}

export async function compressImage(file: File): Promise<CompressionResult> {
  const { default: imageCompression } = await import('browser-image-compression');
  // Convert HEIC to JPEG first (browsers can't process HEIC natively)
  let processableFile = file;
  if (isHeicFile(file)) {
    console.log('[ImageCompression] Converting HEIC to JPEG...');
    processableFile = await convertHeicToJpeg(file);
    console.log('[ImageCompression] HEIC converted successfully');
  }
  const fullSizeOptions = {
    maxSizeMB: 2,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
  };

  const thumbnailOptions = {
    maxSizeMB: 0.2,
    maxWidthOrHeight: 800,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
    initialQuality: 0.85,
  };

  const [fullSize, thumbnail] = await Promise.all([
    imageCompression(processableFile, fullSizeOptions),
    imageCompression(processableFile, thumbnailOptions),
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
  // Standard image MIME types or HEIC (which may have incorrect MIME type)
  return file.type.startsWith('image/') || isHeicFile(file);
}

/**
 * Proves the file's bytes actually decode as an image. Extension/MIME checks
 * pass anything renamed to .png; a file that fails to decode here can never
 * upload successfully, so callers should reject it at selection time with a
 * specific message rather than let it fail later as a generic upload error.
 */
export async function validateImageDecodes(file: File): Promise<boolean> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      return true;
    } catch {
      return false;
    }
  }
  // Fallback for engines without createImageBitmap support.
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
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
