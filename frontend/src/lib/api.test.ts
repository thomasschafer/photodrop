import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Force the web (fetch) transport: api.ts captures isNative at module load.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

import { api, ApiError } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const refreshPayload = {
  accessToken: 'new-token',
  user: { id: 'u1', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' },
  currentGroup: { id: 'g1', name: 'Family', role: 'member', ownerId: 'u0', imageProtection: true },
  groups: [{ id: 'g1', name: 'Family', role: 'member', ownerId: 'u0', imageProtection: true }],
};

describe('fetchWithAuth refresh-on-401', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('accessToken', 'old-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes the token and retries the request once on a 401', async () => {
    const refreshedDetails: unknown[] = [];
    const onRefreshed = (e: Event) => refreshedDetails.push((e as CustomEvent).detail);
    window.addEventListener('auth:token-refreshed', onRefreshed);

    let photoCalls = 0;
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (url.includes('/auth/refresh')) {
        return jsonResponse(refreshPayload);
      }
      photoCalls++;
      return photoCalls === 1
        ? jsonResponse({ error: 'Invalid or expired token' }, 401)
        : jsonResponse({ photos: [], hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.photos.list();

    expect(result).toEqual({ photos: [], hasMore: false });
    expect(localStorage.getItem('accessToken')).toBe('new-token');
    expect(refreshedDetails).toHaveLength(1);

    // Exactly one refresh, and the retry carried the refreshed token.
    const refreshHits = fetchMock.mock.calls.filter(([url]) => url.includes('/auth/refresh'));
    expect(refreshHits).toHaveLength(1);
    const lastCall = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit];
    const retryHeaders = lastCall[1].headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer new-token');

    window.removeEventListener('auth:token-refreshed', onRefreshed);
  });

  it('clears the session and signals expiry when the refresh also fails', async () => {
    let expired = false;
    const onExpired = () => {
      expired = true;
    };
    window.addEventListener('auth:session-expired', onExpired);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          return jsonResponse({ error: 'No refresh token provided' }, 401);
        }
        return jsonResponse({ error: 'Invalid or expired token' }, 401);
      })
    );

    await expect(api.photos.list()).rejects.toBeInstanceOf(ApiError);
    expect(expired).toBe(true);
    expect(localStorage.getItem('accessToken')).toBeNull();

    window.removeEventListener('auth:session-expired', onExpired);
  });

  it('routes to group selection (not logout) when refresh has groups but no token', async () => {
    // Being removed from the active group while still in others: /auth/refresh
    // returns 200 with accessToken=null + selectionToken + groups. This must
    // surface group selection (auth:token-refreshed), not session expiry.
    const refreshedDetails: unknown[] = [];
    let expired = false;
    const onRefreshed = (e: Event) => refreshedDetails.push((e as CustomEvent).detail);
    const onExpired = () => {
      expired = true;
    };
    window.addEventListener('auth:token-refreshed', onRefreshed);
    window.addEventListener('auth:session-expired', onExpired);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          return jsonResponse({
            accessToken: null,
            selectionToken: 'sel-token',
            user: refreshPayload.user,
            currentGroup: null,
            groups: refreshPayload.groups,
            needsGroupSelection: true,
          });
        }
        return jsonResponse({ error: 'Membership no longer exists' }, 401);
      })
    );

    await expect(api.photos.list()).rejects.toBeInstanceOf(ApiError);
    expect(refreshedDetails).toHaveLength(1);
    expect(expired).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();

    window.removeEventListener('auth:token-refreshed', onRefreshed);
    window.removeEventListener('auth:session-expired', onExpired);
  });

  it('does not attempt a refresh for unauthenticated (includeAuth=false) endpoints', async () => {
    let expired = false;
    const onExpired = () => {
      expired = true;
    };
    window.addEventListener('auth:session-expired', onExpired);

    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    // send-login-link is a public endpoint (includeAuth=false): a 401 must
    // surface directly and never recurse into /auth/refresh.
    await expect(api.auth.sendLoginLink('someone@example.com')).rejects.toBeInstanceOf(ApiError);

    // Exactly one request — the original. No refresh retry was attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expired).toBe(false);

    window.removeEventListener('auth:session-expired', onExpired);
  });

  it('shares a single refresh across concurrent 401s', async () => {
    let refreshCalls = 0;
    let photoCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCalls++;
          // Hold the refresh open so both in-flight requests overlap on it.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse(refreshPayload);
        }
        photoCalls++;
        // The two original concurrent requests 401; their retries succeed.
        return photoCalls <= 2
          ? jsonResponse({ error: 'Invalid or expired token' }, 401)
          : jsonResponse({ photos: [], hasMore: false });
      })
    );

    await Promise.all([api.photos.list(), api.photos.list()]);

    expect(refreshCalls).toBe(1);
  });

  it('shares one refresh between the 401-retry path and a direct api.auth.refresh', async () => {
    let refreshCalls = 0;
    let photoCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          refreshCalls++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse(refreshPayload);
        }
        photoCalls++;
        return photoCalls === 1
          ? jsonResponse({ error: 'Invalid or expired token' }, 401)
          : jsonResponse({ photos: [], hasMore: false });
      })
    );

    // A 401-triggered refresh and a direct refresh (as AuthContext's interval/
    // foreground refresh does) at the same time must not double-rotate the cookie.
    await Promise.all([api.photos.list(), api.auth.refresh()]);

    expect(refreshCalls).toBe(1);
  });
});
