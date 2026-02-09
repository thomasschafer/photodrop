import { describe, it, expect } from 'vitest';
import { validateImageMagicBytes, MAX_PHOTO_SIZE, MAX_THUMBNAIL_SIZE, ALLOWED_MIME_TYPES } from './fileValidation';

describe('fileValidation', () => {
  describe('validateImageMagicBytes', () => {
    it('detects JPEG files', () => {
      const buffer = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
      expect(validateImageMagicBytes(buffer)).toBe('image/jpeg');
    });

    it('detects PNG files', () => {
      const buffer = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]).buffer;
      expect(validateImageMagicBytes(buffer)).toBe('image/png');
    });

    it('detects WebP files', () => {
      const buffer = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;
      expect(validateImageMagicBytes(buffer)).toBe('image/webp');
    });

    it('detects HEIC files', () => {
      const brand = 'heic';
      const buffer = new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, ...Array.from(brand).map(c => c.charCodeAt(0))]).buffer;
      expect(validateImageMagicBytes(buffer)).toBe('image/heic');
    });

    it('returns null for too-small buffer', () => {
      const buffer = new Uint8Array([0xFF, 0xD8]).buffer;
      expect(validateImageMagicBytes(buffer)).toBeNull();
    });

    it('returns null for unknown format', () => {
      const buffer = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
      expect(validateImageMagicBytes(buffer)).toBeNull();
    });
  });

  describe('constants', () => {
    it('MAX_PHOTO_SIZE is 20MB', () => {
      expect(MAX_PHOTO_SIZE).toBe(20 * 1024 * 1024);
    });

    it('MAX_THUMBNAIL_SIZE is 1MB', () => {
      expect(MAX_THUMBNAIL_SIZE).toBe(1 * 1024 * 1024);
    });

    it('ALLOWED_MIME_TYPES includes expected types', () => {
      expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
      expect(ALLOWED_MIME_TYPES).toContain('image/png');
      expect(ALLOWED_MIME_TYPES).toContain('image/webp');
      expect(ALLOWED_MIME_TYPES).toContain('image/heic');
    });
  });
});
