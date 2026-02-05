import { getMagicLinkToken, type MagicLinkToken } from './db';

export interface MagicLinkVerificationResult {
  valid: boolean;
  token?: MagicLinkToken;
  error?: 'not_found' | 'expired' | 'already_used' | 'pending' | 'invalid';
}

const PENDING_TIMEOUT_SECONDS = 300; // 5 minutes

/**
 * Verifies a magic link token
 * Checks if token exists, is not expired, not already used, and not pending
 * @param allowPending - If true, skip the pending check (used for name submission flow)
 */
export async function verifyMagicLink(
  db: D1Database,
  tokenString: string,
  allowPending: boolean = false
): Promise<MagicLinkVerificationResult> {
  const token = await getMagicLinkToken(db, tokenString);

  if (!token) {
    return { valid: false, error: 'not_found' };
  }

  if (token.used_at !== null) {
    return { valid: false, error: 'already_used', token };
  }

  const now = Math.floor(Date.now() / 1000);

  if (token.expires_at < now) {
    return { valid: false, error: 'expired', token };
  }

  // Check if another request is currently processing this token
  if (!allowPending && token.pending_at !== null) {
    const pendingCutoff = now - PENDING_TIMEOUT_SECONDS;
    if (token.pending_at > pendingCutoff) {
      return { valid: false, error: 'pending', token };
    }
  }

  return { valid: true, token };
}
