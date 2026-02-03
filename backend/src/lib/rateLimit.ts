/**
 * Rate limiting using D1 database with fixed window algorithm.
 *
 * Uses a simple fixed window approach where each key has a count that resets
 * after the window expires. This is simpler than sliding window but sufficient
 * for most rate limiting needs.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check and update rate limit for a given key.
 * Uses atomic upsert to prevent race conditions with concurrent requests.
 *
 * @param db - D1 database instance
 * @param key - Unique key for rate limiting (e.g., "login:user@example.com")
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowSeconds - Window duration in seconds
 * @returns Rate limit check result
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowCutoff = now - windowSeconds;

  // Atomic upsert: insert new record or update existing
  // If window expired (window_start <= cutoff), reset count to 1 and update window_start
  // If window active, increment count
  const result = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN window_start <= ? THEN 1
           ELSE count + 1
         END,
         window_start = CASE
           WHEN window_start <= ? THEN ?
           ELSE window_start
         END
       RETURNING count, window_start`
    )
    .bind(key, now, windowCutoff, windowCutoff, now)
    .first<{ count: number; window_start: number }>();

  if (!result) {
    // Shouldn't happen with RETURNING, but handle defensively
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowSeconds };
  }

  const resetAt = result.window_start + windowSeconds;

  // If count exceeds limit, request was already counted but should be rejected
  if (result.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: maxRequests - result.count,
    resetAt,
  };
}

/**
 * Clean up expired rate limit entries.
 * Should be called periodically (e.g., on 1% of requests).
 *
 * @param db - D1 database instance
 * @param maxAgeSeconds - Delete entries older than this (default: 1 hour)
 */
export async function cleanupExpiredRateLimits(
  db: D1Database,
  maxAgeSeconds: number = 3600
): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();
}
