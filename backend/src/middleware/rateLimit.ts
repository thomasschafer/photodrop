/**
 * Rate limiting middleware for Hono routes.
 */

import { Context, Next } from 'hono';
import { checkRateLimit, cleanupExpiredRateLimits } from '../lib/rateLimit';

// Key for storing parsed body in context to avoid double-parsing
const PARSED_BODY_KEY = 'rateLimitParsedBody';

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Function to extract the rate limit key from the request */
  keyFn: (c: Context) => Promise<string | null> | string | null;
  /** Optional: probability of triggering cleanup (0-1, default 0.01 = 1%) */
  cleanupProbability?: number;
}

/**
 * Get client IP address from Cloudflare headers or fallback.
 */
export function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Safely parse JSON body, caching the result to allow multiple reads.
 * This clones the request to read the body without consuming the original.
 */
async function getJsonBody(c: Context): Promise<unknown> {
  // Return cached body if already parsed
  const cached = c.get(PARSED_BODY_KEY);
  if (cached !== undefined) {
    return cached;
  }

  try {
    // Clone the request to read body without consuming original
    const clonedRequest = c.req.raw.clone();
    const body = await clonedRequest.json();
    c.set(PARSED_BODY_KEY, body);
    return body;
  } catch {
    c.set(PARSED_BODY_KEY, null);
    return null;
  }
}

/**
 * Create a rate limiting middleware with the given configuration.
 *
 * Example usage:
 * ```typescript
 * app.post('/auth/send-login-link',
 *   createRateLimitMiddleware({
 *     maxRequests: 5,
 *     windowSeconds: 15 * 60,
 *     keyFn: rateLimitKeys.byEmailFromBody('login'),
 *   }),
 *   async (c) => { ... }
 * );
 * ```
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const { maxRequests, windowSeconds, keyFn, cleanupProbability = 0.01 } = config;

  return async (c: Context, next: Next) => {
    const db = c.env.DB;

    if (!db) {
      console.warn('Rate limiting: DB not available, skipping');
      await next();
      return;
    }

    // Extract the rate limit key
    const key = await keyFn(c);

    if (!key) {
      // If key extraction fails (e.g., missing email), let the request through
      // The actual handler should validate the request
      await next();
      return;
    }

    // Check rate limit
    const result = await checkRateLimit(db, key, maxRequests, windowSeconds);

    // Add rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      const retryAfter = result.resetAt - Math.floor(Date.now() / 1000);
      c.header('Retry-After', Math.max(retryAfter, 1).toString());
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    // Probabilistic cleanup of expired entries
    if (Math.random() < cleanupProbability) {
      c.executionCtx.waitUntil(cleanupExpiredRateLimits(db));
    }

    await next();
  };
}

/**
 * Pre-built key extractors for common use cases.
 */
export const rateLimitKeys = {
  /** Rate limit by IP address */
  byIP: (prefix: string) => (c: Context) => `${prefix}:${getClientIP(c)}`,

  /** Rate limit by authenticated user ID (requires auth middleware first) */
  byUserId: (prefix: string) => (c: Context) => {
    const user = c.get('user');
    return user ? `${prefix}:${user.id}` : null;
  },

  /** Rate limit by email from JSON body, falling back to IP if extraction fails */
  byEmailFromBody:
    (prefix: string) =>
    async (c: Context): Promise<string> => {
      try {
        const body = (await getJsonBody(c)) as { email?: string } | null;
        const email = body?.email;
        if (typeof email === 'string' && email.includes('@')) {
          return `${prefix}:${email.toLowerCase()}`;
        }
      } catch {
        // Fall through to IP fallback
      }
      // Fallback to IP-based limiting to prevent bypass via malformed requests
      return `${prefix}:ip:${getClientIP(c)}`;
    },
};
