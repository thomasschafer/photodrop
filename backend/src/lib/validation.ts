/**
 * Validation utilities
 */

// RFC 5322 simplified email regex - handles most real-world email formats
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validate an email address with a proper regex (not just checking for @)
 *
 * NOTE: This function is kept for compatibility but Zod schemas (lib/schemas.ts)
 * are now the primary email validation method in route handlers.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321 max length
  return EMAIL_REGEX.test(email);
}
