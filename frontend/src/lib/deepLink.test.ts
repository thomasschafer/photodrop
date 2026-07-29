import { describe, it, expect, vi, beforeEach } from 'vitest';

// The buffer is module state, so each test gets a fresh copy of the module.
async function loadDeepLink() {
  vi.resetModules();
  return import('./deepLink');
}

describe('deepLinkPathFromUrl', () => {
  it('returns the path and query of a well-formed URL', async () => {
    const { deepLinkPathFromUrl } = await loadDeepLink();

    expect(deepLinkPathFromUrl('https://photodrop.example/photo/p1?from=push')).toBe(
      '/photo/p1?from=push'
    );
  });

  it('returns null for an unparseable URL instead of throwing', async () => {
    // Capacitor hands us whatever the OS passed. Throwing out of the appUrlOpen
    // handler would take down every later deep link on the same listener.
    const { deepLinkPathFromUrl } = await loadDeepLink();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(deepLinkPathFromUrl('not a url')).toBeNull();
  });
});

describe('deep link delivery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('replays a link published before anything subscribed', async () => {
    // The cold-start case: CapApp.getLaunchUrl() resolves at module scope, which
    // can beat React's first render, so the link must survive until App mounts.
    const { publishDeepLink, subscribeToDeepLinks } = await loadDeepLink();

    publishDeepLink('/photo/p1');

    const handler = vi.fn();
    subscribeToDeepLinks(handler);

    expect(handler).toHaveBeenCalledWith('/photo/p1');
  });

  it('replays a buffered link only once', async () => {
    // A remount must not navigate the user back to a link already followed.
    const { publishDeepLink, subscribeToDeepLinks } = await loadDeepLink();

    publishDeepLink('/photo/p1');

    const first = vi.fn();
    const unsubscribe = subscribeToDeepLinks(first);
    unsubscribe();

    const second = vi.fn();
    subscribeToDeepLinks(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('delivers straight to a live subscriber', async () => {
    const { publishDeepLink, subscribeToDeepLinks } = await loadDeepLink();

    const handler = vi.fn();
    subscribeToDeepLinks(handler);

    publishDeepLink('/members');

    expect(handler).toHaveBeenCalledWith('/members');
  });

  it('stops delivering after unsubscribe', async () => {
    const { publishDeepLink, subscribeToDeepLinks } = await loadDeepLink();

    const handler = vi.fn();
    subscribeToDeepLinks(handler)();

    publishDeepLink('/members');

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps only the newest link when several arrive before a subscriber', async () => {
    const { publishDeepLink, subscribeToDeepLinks } = await loadDeepLink();

    publishDeepLink('/photo/p1');
    publishDeepLink('/photo/p2');

    const handler = vi.fn();
    subscribeToDeepLinks(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('/photo/p2');
  });
});
