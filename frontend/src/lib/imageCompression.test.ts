import { describe, it, expect } from 'vitest';
import { formatFileSize, isImageFile, validateImageFile } from './imageCompression';

describe('Image compression utilities', () => {
  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 Bytes');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('isImageFile', () => {
    it('should return true for image files', () => {
      const jpegFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
      const pngFile = new File([''], 'test.png', { type: 'image/png' });
      const webpFile = new File([''], 'test.webp', { type: 'image/webp' });

      expect(isImageFile(jpegFile)).toBe(true);
      expect(isImageFile(pngFile)).toBe(true);
      expect(isImageFile(webpFile)).toBe(true);
    });

    it('should return false for non-image files', () => {
      const textFile = new File([''], 'test.txt', { type: 'text/plain' });
      const pdfFile = new File([''], 'test.pdf', { type: 'application/pdf' });
      const videoFile = new File([''], 'test.mp4', { type: 'video/mp4' });

      expect(isImageFile(textFile)).toBe(false);
      expect(isImageFile(pdfFile)).toBe(false);
      expect(isImageFile(videoFile)).toBe(false);
    });
  });

  describe('validateImageFile', () => {
    it('should accept valid image files', () => {
      const validFile = new File(['x'.repeat(1000)], 'test.jpg', {
        type: 'image/jpeg',
      });

      const result = validateImageFile(validFile);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject non-image files', () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      const result = validateImageFile(textFile);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File must be an image');
    });

    it('should reject files larger than 50MB', () => {
      const largeContent = new ArrayBuffer(51 * 1024 * 1024);
      const largeFile = new File([largeContent], 'large.jpg', {
        type: 'image/jpeg',
      });

      const result = validateImageFile(largeFile);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File size must be less than 50MB');
    });

    it('should accept files exactly at 50MB', () => {
      const content = new ArrayBuffer(50 * 1024 * 1024);
      const file = new File([content], 'exact.jpg', { type: 'image/jpeg' });

      const result = validateImageFile(file);
      expect(result.valid).toBe(true);
    });
  });
});
