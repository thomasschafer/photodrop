import { describe, it, expect } from 'vitest';
import { PROFILE_COLORS, getInitials } from './profileColors';

describe('Profile colors', () => {
  describe('PROFILE_COLORS', () => {
    it('contains exactly 20 colors', () => {
      expect(PROFILE_COLORS).toHaveLength(20);
    });

    it('contains no duplicates', () => {
      const unique = new Set(PROFILE_COLORS);
      expect(unique.size).toBe(PROFILE_COLORS.length);
    });
  });

  describe('getInitials', () => {
    it('returns single initial for single name', () => {
      expect(getInitials('Alice')).toBe('A');
    });

    it('returns first + last initial for two names', () => {
      expect(getInitials('Alice Smith')).toBe('AS');
    });

    it('returns first + last initial for three names', () => {
      expect(getInitials('Mary Jane Watson')).toBe('MW');
    });

    it('uppercases initials', () => {
      expect(getInitials('alice smith')).toBe('AS');
    });

    it('handles extra whitespace', () => {
      expect(getInitials('  Alice   Smith  ')).toBe('AS');
    });

    it('returns empty string for empty input', () => {
      expect(getInitials('')).toBe('');
    });
  });
});
