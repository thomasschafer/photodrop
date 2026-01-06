import { getMagicLinkToken, markMagicLinkTokenUsed, type MagicLinkToken } from './db';

export interface MagicLinkVerificationResult {
  valid: boolean;
  token?: MagicLinkToken;
  error?: 'not_found' | 'expired' | 'already_used' | 'invalid';
}

/**
 * Verifies a magic link token
 * Checks if token exists, is not expired, and has not been used
 */
export async function verifyMagicLink(
  db: D1Database,
  tokenString: string
): Promise<MagicLinkVerificationResult> {
  // Get token from database
  const token = await getMagicLinkToken(db, tokenString);

  if (!token) {
    return { valid: false, error: 'not_found' };
  }

  // Check if already used
  if (token.used_at !== null) {
    return { valid: false, error: 'already_used', token };
  }

  // Check if expired
  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at < now) {
    return { valid: false, error: 'expired', token };
  }

  // Token is valid
  return { valid: true, token };
}

/**
 * Verifies and marks a magic link token as used
 * This should be called atomically after successful verification
 */
export async function verifyAndConsumeToken(
  db: D1Database,
  tokenString: string
): Promise<MagicLinkVerificationResult> {
  const result = await verifyMagicLink(db, tokenString);

  if (result.valid && result.token) {
    // Mark token as used
    await markMagicLinkTokenUsed(db, tokenString);
  }

  return result;
}
