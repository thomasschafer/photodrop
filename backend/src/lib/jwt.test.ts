import { describe, it, expect } from 'vitest';
import { generateJWT, verifyJWT, generateAccessToken, generateRefreshToken } from './jwt';

describe('JWT utilities', () => {
  const testSecret = 'test-secret-key-for-jwt';
  const userId = 'user-123';
  const role = 'viewer' as const;

  describe('generateJWT', () => {
    it('should generate a valid JWT token', async () => {
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        60
      );

      expect(token).toBeTruthy();
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct payload data', async () => {
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        60
      );

      const payload = await verifyJWT(token, testSecret);
      expect(payload).toBeTruthy();
      expect(payload?.sub).toBe(userId);
      expect(payload?.role).toBe(role);
      expect(payload?.type).toBe('access');
    });

    it('should set expiration correctly', async () => {
      const expiresIn = 60;
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        expiresIn
      );

      const payload = await verifyJWT(token, testSecret);
      expect(payload).toBeTruthy();

      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now);
      expect(payload?.exp).toBeLessThanOrEqual(now + expiresIn + 1);
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', async () => {
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        60
      );

      const payload = await verifyJWT(token, testSecret);
      expect(payload).toBeTruthy();
      expect(payload?.sub).toBe(userId);
    });

    it('should reject token with wrong secret', async () => {
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        60
      );

      const payload = await verifyJWT(token, 'wrong-secret');
      expect(payload).toBeNull();
    });

    it('should reject malformed token', async () => {
      const payload = await verifyJWT('invalid.token', testSecret);
      expect(payload).toBeNull();
    });

    it('should reject expired token', async () => {
      const token = await generateJWT(
        { sub: userId, role, type: 'access' },
        testSecret,
        -1 // Already expired
      );

      const payload = await verifyJWT(token, testSecret);
      expect(payload).toBeNull();
    });
  });

  describe('generateAccessToken', () => {
    it('should generate access token with correct type', async () => {
      const token = await generateAccessToken(userId, role, testSecret);
      const payload = await verifyJWT(token, testSecret);

      expect(payload?.type).toBe('access');
      expect(payload?.sub).toBe(userId);
      expect(payload?.role).toBe(role);
    });

    it('should have 15 minute expiration', async () => {
      const token = await generateAccessToken(userId, role, testSecret);
      const payload = await verifyJWT(token, testSecret);

      const now = Math.floor(Date.now() / 1000);
      const fifteenMinutes = 15 * 60;
      expect(payload?.exp).toBeGreaterThan(now);
      expect(payload?.exp).toBeLessThanOrEqual(now + fifteenMinutes + 1);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate refresh token with correct type', async () => {
      const token = await generateRefreshToken(userId, role, testSecret);
      const payload = await verifyJWT(token, testSecret);

      expect(payload?.type).toBe('refresh');
      expect(payload?.sub).toBe(userId);
      expect(payload?.role).toBe(role);
    });

    it('should have 30 day expiration', async () => {
      const token = await generateRefreshToken(userId, role, testSecret);
      const payload = await verifyJWT(token, testSecret);

      const now = Math.floor(Date.now() / 1000);
      const thirtyDays = 30 * 24 * 60 * 60;
      expect(payload?.exp).toBeGreaterThan(now);
      expect(payload?.exp).toBeLessThanOrEqual(now + thirtyDays + 1);
    });
  });

  describe('role-based tokens', () => {
    it('should generate tokens for admin role', async () => {
      const adminToken = await generateAccessToken(userId, 'admin', testSecret);
      const payload = await verifyJWT(adminToken, testSecret);

      expect(payload?.role).toBe('admin');
    });

    it('should generate tokens for viewer role', async () => {
      const viewerToken = await generateAccessToken(userId, 'viewer', testSecret);
      const payload = await verifyJWT(viewerToken, testSecret);

      expect(payload?.role).toBe('viewer');
    });
  });
});
