import { describe, it, expect, vi } from 'vitest';
import { verifyMagicLink } from './magic-links';

function createMockDb(token: unknown) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(token),
      }),
    }),
  } as unknown as D1Database;
}

describe('verifyMagicLink', () => {
  const now = Math.floor(Date.now() / 1000);

  it('returns valid for a fresh token', async () => {
    const token = {
      token: 'abc123',
      group_id: 'g1',
      email: 'test@example.com',
      type: 'invite',
      invite_role: 'member',
      created_at: now - 60,
      expires_at: now + 600,
      used_at: null,
      pending_at: null,
    };
    const db = createMockDb(token);
    const result = await verifyMagicLink(db, 'abc123');
    expect(result.valid).toBe(true);
    expect(result.token).toEqual(token);
  });

  it('returns not_found for missing token', async () => {
    const db = createMockDb(null);
    const result = await verifyMagicLink(db, 'nonexistent');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('returns already_used for used token', async () => {
    const token = {
      token: 'abc123',
      expires_at: now + 600,
      used_at: now - 30,
      pending_at: null,
    };
    const db = createMockDb(token);
    const result = await verifyMagicLink(db, 'abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('already_used');
  });

  it('returns expired for expired token', async () => {
    const token = {
      token: 'abc123',
      expires_at: now - 600,
      used_at: null,
      pending_at: null,
    };
    const db = createMockDb(token);
    const result = await verifyMagicLink(db, 'abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('returns pending for recently pending token', async () => {
    const token = {
      token: 'abc123',
      expires_at: now + 600,
      used_at: null,
      pending_at: now - 10, // recently set pending
    };
    const db = createMockDb(token);
    const result = await verifyMagicLink(db, 'abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('pending');
  });

  it('allows pending token when allowPending is true', async () => {
    const token = {
      token: 'abc123',
      expires_at: now + 600,
      used_at: null,
      pending_at: now - 10,
    };
    const db = createMockDb(token);
    const result = await verifyMagicLink(db, 'abc123', true);
    expect(result.valid).toBe(true);
  });
});
