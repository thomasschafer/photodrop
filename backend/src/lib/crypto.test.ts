import { describe, it, expect } from 'vitest';
import { generateId, generateInviteToken } from './crypto';

describe('Crypto utilities', () => {
  describe('generateId', () => {
    it('should generate a 32 character hex string', () => {
      const id = generateId();
      expect(id).toHaveLength(32);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateInviteToken', () => {
    it('should generate a 64 character hex string', () => {
      const token = generateInviteToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateInviteToken());
      }
      expect(tokens.size).toBe(100);
    });

    it('should generate cryptographically different tokens', () => {
      const token1 = generateInviteToken();
      const token2 = generateInviteToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(token2.length);
    });
  });
});
