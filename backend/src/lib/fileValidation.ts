/**
 * File validation utilities for secure upload handling
 */

/**
 * Validates that the file content matches an allowed image format by checking magic bytes.
 * This prevents attackers from uploading malicious files with spoofed MIME types.
 *
 * @param buffer - The file content as ArrayBuffer
 * @returns The detected MIME type, or null if not a valid image
 */
export function validateImageMagicBytes(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 12) {
    return null;
  }

  // Check JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // Check PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // Check WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // Check HEIC/HEIF: ftyp at offset 4, then heic/heix/mif1/msf1
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    // Check brand at offset 8
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (['heic', 'heix', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand)) {
      return 'image/heic';
    }
  }

  return null;
}

/**
 * Upload size limits
 */
export const MAX_PHOTO_SIZE = 20 * 1024 * 1024; // 20MB
export const MAX_THUMBNAIL_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * Allowed MIME types for uploads
 */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
