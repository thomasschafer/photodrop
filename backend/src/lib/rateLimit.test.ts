import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit, cleanupExpiredRateLimits } from './rateLimit';

function createMockDb(firstResult: { count: number; window_start: number } | null = null) {
  const mockFirst = vi.fn().mockResolvedValue(firstResult);
  const mockRun = vi.fn().mockResolvedValue({ success: true });
  const mockBind = vi.fn().mockReturnValue({ first: mockFirst, run: mockRun });
  const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

  return {
    prepare: mockPrepare,
    _mocks: { mockPrepare, mockBind, mockFirst, mockRun },
  } as unknown as D1Database & { _mocks: Record<string, ReturnType<typeof vi.fn>> };
}

describe('checkRateLimit', () => {
  it('allows request when under limit', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({ count: 1, window_start: now });

    const result = await checkRateLimit(db, 'test:key', 5, 3600);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('rejects request when over limit', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({ count: 6, window_start: now });

    const result = await checkRateLimit(db, 'test:key', 5, 3600);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns allowed with defaults when result is null', async () => {
    const db = createMockDb(null);

    const result = await checkRateLimit(db, 'test:key', 5, 3600);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });
});

describe('cleanupExpiredRateLimits', () => {
  it('deletes entries older than maxAgeSeconds', async () => {
    const db = createMockDb();

    await cleanupExpiredRateLimits(db);

    expect(db._mocks.mockPrepare).toHaveBeenCalledWith(
      'DELETE FROM rate_limits WHERE window_start < ?'
    );
    expect(db._mocks.mockRun).toHaveBeenCalled();
  });
});
