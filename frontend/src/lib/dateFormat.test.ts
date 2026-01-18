import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrdinalSuffix, formatRelativeTime } from './dateFormat';

describe('Date formatting utilities', () => {
  describe('getOrdinalSuffix', () => {
    it('should return "st" for 1, 21, 31', () => {
      expect(getOrdinalSuffix(1)).toBe('st');
      expect(getOrdinalSuffix(21)).toBe('st');
      expect(getOrdinalSuffix(31)).toBe('st');
    });

    it('should return "nd" for 2, 22', () => {
      expect(getOrdinalSuffix(2)).toBe('nd');
      expect(getOrdinalSuffix(22)).toBe('nd');
    });

    it('should return "rd" for 3, 23', () => {
      expect(getOrdinalSuffix(3)).toBe('rd');
      expect(getOrdinalSuffix(23)).toBe('rd');
    });

    it('should return "th" for 11, 12, 13 (special cases)', () => {
      expect(getOrdinalSuffix(11)).toBe('th');
      expect(getOrdinalSuffix(12)).toBe('th');
      expect(getOrdinalSuffix(13)).toBe('th');
    });

    it('should return "th" for other numbers', () => {
      expect(getOrdinalSuffix(4)).toBe('th');
      expect(getOrdinalSuffix(5)).toBe('th');
      expect(getOrdinalSuffix(10)).toBe('th');
      expect(getOrdinalSuffix(14)).toBe('th');
      expect(getOrdinalSuffix(20)).toBe('th');
      expect(getOrdinalSuffix(25)).toBe('th');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-18T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "Just now" for timestamps less than 1 minute ago', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now)).toBe('Just now');
      expect(formatRelativeTime(now - 30)).toBe('Just now');
      expect(formatRelativeTime(now - 59)).toBe('Just now');
    });

    it('should return minutes ago for timestamps 1-59 minutes ago', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 60)).toBe('1m ago');
      expect(formatRelativeTime(now - 120)).toBe('2m ago');
      expect(formatRelativeTime(now - 59 * 60)).toBe('59m ago');
    });

    it('should return hours ago for timestamps 1-23 hours ago', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 60 * 60)).toBe('1h ago');
      expect(formatRelativeTime(now - 2 * 60 * 60)).toBe('2h ago');
      expect(formatRelativeTime(now - 23 * 60 * 60)).toBe('23h ago');
    });

    it('should return days ago for timestamps 1-6 days ago', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 24 * 60 * 60)).toBe('1d ago');
      expect(formatRelativeTime(now - 3 * 24 * 60 * 60)).toBe('3d ago');
      expect(formatRelativeTime(now - 6 * 24 * 60 * 60)).toBe('6d ago');
    });

    it('should return absolute date for timestamps 7+ days ago', () => {
      const now = Math.floor(Date.now() / 1000);
      // 7 days ago from 18th Jan 2026 = 11th Jan 2026
      expect(formatRelativeTime(now - 7 * 24 * 60 * 60)).toBe('11th Jan 2026');
      // 10 days ago = 8th Jan 2026
      expect(formatRelativeTime(now - 10 * 24 * 60 * 60)).toBe('8th Jan 2026');
    });

    it('should format absolute dates with correct ordinal suffixes', () => {
      // Test various dates to check ordinal formatting
      // 1st Jan 2026
      const jan1 = new Date('2026-01-01T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(jan1)).toBe('1st Jan 2026');

      // 2nd Jan 2026
      const jan2 = new Date('2026-01-02T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(jan2)).toBe('2nd Jan 2026');

      // 3rd Jan 2026
      const jan3 = new Date('2026-01-03T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(jan3)).toBe('3rd Jan 2026');

      // 11th Dec 2025 (special case)
      const dec11 = new Date('2025-12-11T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(dec11)).toBe('11th Dec 2025');

      // 21st Dec 2025
      const dec21 = new Date('2025-12-21T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(dec21)).toBe('21st Dec 2025');

      // 22nd Dec 2025
      const dec22 = new Date('2025-12-22T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(dec22)).toBe('22nd Dec 2025');

      // 23rd Dec 2025
      const dec23 = new Date('2025-12-23T12:00:00Z').getTime() / 1000;
      expect(formatRelativeTime(dec23)).toBe('23rd Dec 2025');
    });
  });
});
