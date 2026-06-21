import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from './logger';

/**
 * Centralized error handler registered via `app.onError`.
 *
 * Exported (rather than defined inline in index.ts) so that route-level tests
 * can register the exact same handler the production app uses — otherwise a
 * route that relies on this for ZodError -> 400 formatting would silently fall
 * back to Hono's default 500 when mounted in isolation.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    const messages = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
    return c.json({ error: 'Validation error', details: messages }, 400);
  }

  // Preserve the intended response for anything that throws Hono's HTTPException
  // (e.g. middleware/libraries) rather than collapsing it into a generic 500.
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
  return c.json({ error: 'Internal server error' }, 500);
};
