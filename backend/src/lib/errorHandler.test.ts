import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { errorHandler } from './errorHandler';

function createApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('formats a thrown ZodError as 400 with details', async () => {
    const app = createApp();
    const schema = z.object({ emoji: z.enum(['❤️', '😂']) });
    app.post('/react', async (c) => {
      const body = await c.req.json();
      schema.parse(body);
      return c.json({ ok: true });
    });

    const res = await app.request('/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: 'not-an-emoji' }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; details: string[] };
    expect(json.error).toBe('Validation error');
    expect(Array.isArray(json.details)).toBe(true);
    expect(json.details.join(' ')).toContain('emoji');
  });

  it('includes the field path in validation details for nested fields', async () => {
    const app = createApp();
    const schema = z.object({ keys: z.object({ p256dh: z.string().min(1) }) });
    app.post('/nested', async (c) => {
      schema.parse(await c.req.json());
      return c.json({ ok: true });
    });

    const res = await app.request('/nested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { p256dh: '' } }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { details: string[] };
    expect(json.details.join(' ')).toContain('keys.p256dh');
  });

  it('preserves the status and body of a thrown HTTPException', async () => {
    const app = createApp();
    app.get('/forbidden', () => {
      throw new HTTPException(403, { message: 'Nope' });
    });

    const res = await app.request('/forbidden');

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Nope');
  });

  it('maps unexpected (non-Zod) errors to a generic 500', async () => {
    const app = createApp();
    app.get('/boom', () => {
      throw new Error('database exploded');
    });

    const res = await app.request('/boom');

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Internal server error');
    // The internal message must not leak to the client.
    expect(JSON.stringify(json)).not.toContain('database exploded');
  });
});
