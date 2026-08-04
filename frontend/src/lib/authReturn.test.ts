import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeAuthReturnPath, rememberAuthReturnPath } from './authReturn';

describe('auth return paths', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('remembers a safe photo path once', () => {
    rememberAuthReturnPath('/photo/photo-1?group=group-1');

    expect(consumeAuthReturnPath()).toBe('/photo/photo-1?group=group-1');
    expect(consumeAuthReturnPath()).toBe('/');
  });

  it('expires an abandoned return path after one hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    rememberAuthReturnPath('/photo/photo-1');
    vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));

    expect(consumeAuthReturnPath()).toBe('/');
  });

  it('never stores a non-photo app route', () => {
    rememberAuthReturnPath('/members');

    expect(consumeAuthReturnPath()).toBe('/');
  });

  it('falls back to home when browser storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Storage unavailable');
    });

    expect(consumeAuthReturnPath()).toBe('/');
  });

  it('falls back to home when browser storage cannot be cleared', () => {
    localStorage.setItem(
      'photodrop:auth-return-path',
      JSON.stringify({ path: '/photo/photo-1', savedAt: Date.now() })
    );
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new DOMException('Storage unavailable');
    });

    expect(consumeAuthReturnPath()).toBe('/');
  });
});
