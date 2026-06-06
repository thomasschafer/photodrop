/**
 * Shared HTTP helpers for route handlers: a 400 error type, route-param
 * extraction, and JSON body parsing + validation. Centralised so handlers don't
 * each re-implement (and subtly diverge on) request validation.
 */
import type { Context } from 'hono';
import type { z } from 'zod';

export class BadRequestError extends Error {
  readonly statusCode = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export function requireParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new BadRequestError(`Missing route parameter: ${name}`);
  }

  return value;
}

/**
 * Read and validate a JSON request body against a Zod schema. Throws
 * BadRequestError (HTTP 400) on malformed JSON or schema violations, surfacing
 * the schema's own message so callers get a precise, client-safe error.
 */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError('Request body must be valid JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid request body');
  }

  return result.data;
}
