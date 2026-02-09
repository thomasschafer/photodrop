import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validation';

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user.name@example.com')).toBe(true);
    expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user@.com')).toBe(false);
  });

  it('rejects emails longer than 254 chars', () => {
    const longEmail = 'a'.repeat(246) + '@test.com'; // 255 chars
    expect(isValidEmail(longEmail)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidEmail(null as unknown as string)).toBe(false);
    expect(isValidEmail(undefined as unknown as string)).toBe(false);
  });
});
