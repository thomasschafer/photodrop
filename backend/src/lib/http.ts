/**
 * Shared HTTP helpers for route handlers: error types that map directly to
 * HTTP responses, route-param extraction, and JSON body parsing + validation.
 * Centralised so handlers don't each re-implement (and subtly diverge on)
 * request validation and error formatting.
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Base class for errors that map directly to an HTTP response. Routes and
 * middleware throw these; the global errorHandler converts them to
 * `{ error: message }` JSON with the right status code.
 */
export abstract class HttpError extends Error {
  abstract readonly statusCode: ContentfulStatusCode;
}

export class BadRequestError extends HttpError {
  readonly statusCode = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends HttpError {
  readonly statusCode = 401 as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  readonly statusCode = 403 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  readonly statusCode = 404 as const;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class InternalServerError extends HttpError {
  readonly statusCode = 500 as const;

  constructor(message: string) {
    super(message);
    this.name = 'InternalServerError';
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
