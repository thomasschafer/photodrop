import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ApiError } from '../lib/api';
import { clearAllUserCaches } from '../lib/cache';

const mockGetMe = vi.fn();
const mockRefresh = vi.fn();
const mockSelectGroup = vi.fn();

// Mock only the network surface (the `api` object); keep the real, pure
// isSessionExpired/ApiError so the tests exercise production's actual
// expiry classification rather than a hand-rolled copy that could drift.
vi.mock('../lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      users: { getMe: (...a: unknown[]) => mockGetMe(...a) },
      auth: {
        refresh: (...a: unknown[]) => mockRefresh(...a),
        logout: vi.fn().mockResolvedValue({}),
        switchGroup: vi.fn(),
        selectGroup: (...a: unknown[]) => mockSelectGroup(...a),
      },
      push: { unsubscribe: vi.fn().mockResolvedValue(undefined) },
    },
  };
});

// api.ts reads Capacitor.isNativePlatform() at module load, so the real module
// (pulled in above via importActual) needs this stubbed.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

vi.mock('../lib/cache', () => ({
  clearAllUserCaches: vi.fn(),
  clearGroupCaches: vi.fn(),
}));

vi.mock('../lib/nativePush', () => ({
  isNativePlatform: () => false,
  initializeNativePush: vi.fn(),
  cleanupOnLogout: vi.fn().mockResolvedValue(undefined),
  onGroupSwitch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/privacyScreen', () => ({
  setNativeScreenshotProtection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));

const user = { id: 'u1', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' as const };
const currentGroup = {
  id: 'g1',
  name: 'Family',
  role: 'member' as const,
  ownerId: 'u0',
  imageProtection: true,
};

const meResponse = { ...user, currentGroup, groups: [currentGroup] };
const refreshResponse = { accessToken: 'fresh-token', user, currentGroup, groups: [currentGroup] };

function Consumer() {
  const { user: u, loading } = useAuth();
  const location = useLocation();
  return (
    <div>
      <span data-testid="status">{loading ? 'loading' : u ? `user:${u.name}` : 'anon'}</span>
      <span data-testid="path">{location.pathname}</span>
    </div>
  );
}

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </MemoryRouter>
  );
}

/**
 * Render and wait until the provider is signed in *and* its effects have run.
 *
 * The signed-in state arrives from a promise continuation inside initAuth that
 * isn't wrapped in act, so findByText can resolve as soon as the DOM updates —
 * before React has flushed the passive effects that attach the
 * visibilitychange and auth-event listeners. A test that dispatched into that
 * gap saw its event go nowhere, which made these tests fail intermittently on
 * slower CI runners. The empty act() flushes those effects.
 */
async function renderSignedIn(initialPath = '/') {
  const utils = renderApp(initialPath);
  await screen.findByText('user:Tom');
  await act(async () => {});
  return utils;
}

describe('AuthProvider session resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('accessToken', 'initial-token');
    mockGetMe.mockResolvedValue(meResponse);
    mockRefresh.mockResolvedValue(refreshResponse);
    // Reinstated per test: two tests below swap in a promise they resolve by
    // hand, and clearAllMocks leaves implementations in place — a failure part
    // way through one of those would otherwise hang every later test on it.
    vi.mocked(clearAllUserCaches).mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    // jsdom has no navigator.serviceWorker; the push-cleanup test defines one.
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('refreshes the session when the app returns to the foreground', async () => {
    await renderSignedIn();

    // Bootstrapping uses getMe, not refresh.
    expect(mockRefresh).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('throttles foreground refreshes that fire in quick succession', async () => {
    await renderSignedIn();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The 30s throttle collapses the burst into a single refresh.
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('stays logged in when a foreground refresh fails transiently', async () => {
    await renderSignedIn();

    // A network blip / 5xx on the foreground refresh must not sign the user out.
    mockRefresh.mockRejectedValue(new Error('network down'));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('status').textContent).toBe('user:Tom');
    expect(localStorage.getItem('accessToken')).toBe('initial-token');
  });

  it('logs out when a foreground refresh is rejected as expired (401)', async () => {
    await renderSignedIn();

    mockRefresh.mockRejectedValue(new ApiError(401, 'Unauthorized', 'Expired'));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('clears state and routes to /login when the session expires', async () => {
    await renderSignedIn();

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('anon');
      expect(screen.getByTestId('path').textContent).toBe('/login');
    });
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('does not redirect away from a magic-link route when the session expires', async () => {
    // A stale session in the same browser must not bounce the user off the
    // /auth/:token verify page they just opened.
    await renderSignedIn('/auth/some-token');

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
    // State is cleared, but the route is left intact for the verify flow.
    expect(screen.getByTestId('path').textContent).toBe('/auth/some-token');
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('recovers a selection token after the current group is deleted', async () => {
    // Deleting the current group invalidates the access token. The provider
    // must re-sync via /auth/refresh — which returns the selection token the
    // group picker needs — rather than patching state locally, where a null
    // selectionToken would make every selectGroup call fail.
    const otherGroup = { ...currentGroup, id: 'g2', name: 'Friends' };
    mockRefresh.mockResolvedValue({
      accessToken: null,
      selectionToken: 'post-delete-selection-token',
      user,
      currentGroup: null,
      groups: [otherGroup],
      needsGroupSelection: true,
    });
    mockSelectGroup.mockResolvedValue({
      accessToken: 'new-token',
      user,
      currentGroup: otherGroup,
      groups: [otherGroup],
    });

    function DeleteFlowConsumer() {
      const { onGroupDeleted, selectGroup, needsGroupSelection } = useAuth();
      return (
        <div>
          <span data-testid="picker">{needsGroupSelection ? 'picker' : 'no-picker'}</span>
          <button onClick={() => onGroupDeleted()}>delete</button>
          <button onClick={() => selectGroup('g2')}>pick</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <DeleteFlowConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('no-picker');

    await act(async () => {
      screen.getByText('delete').click();
    });

    await screen.findByText('picker');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('accessToken')).toBeNull();

    await act(async () => {
      screen.getByText('pick').click();
    });

    expect(mockSelectGroup).toHaveBeenCalledWith('post-delete-selection-token', 'g2');
    expect(localStorage.getItem('accessToken')).toBe('new-token');
  });

  it('does not resolve logout until cached photos have been cleared', async () => {
    // clearAllUserCaches only drops the in-memory image cache once the Cache
    // API deletion resolves, so teardown must await it — otherwise logout
    // reports success while decoded photos are still held in memory.
    let finishCacheClear!: () => void;
    vi.mocked(clearAllUserCaches).mockReturnValue(
      new Promise<void>((resolve) => {
        finishCacheClear = resolve;
      })
    );

    const logoutRef: { current: (() => Promise<void>) | null } = { current: null };
    function LogoutConsumer() {
      const { logout } = useAuth();
      useEffect(() => {
        logoutRef.current = logout;
      }, [logout]);
      return null;
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(logoutRef.current).not.toBeNull());

    let loggedOut = false;
    const pending = logoutRef.current!().then(() => {
      loggedOut = true;
    });

    // Let every already-resolved promise in logout settle; it must still be
    // parked on the cache cleanup.
    await act(async () => {
      await Promise.resolve();
    });
    expect(loggedOut).toBe(false);

    finishCacheClear();
    await act(async () => {
      await pending;
    });
    expect(loggedOut).toBe(true);
  });

  it('clears cached data when a foreground refresh finds the session expired', async () => {
    // Every teardown path must leave the same state behind. This one runs with
    // no user interaction, so leaving another session's photos in the caches
    // would be invisible until someone else signs in on the device. The
    // interval refresh shares this code path via refreshAuth.

    await renderSignedIn();

    mockRefresh.mockRejectedValue(new ApiError(401, 'Unauthorized', 'Expired'));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
    expect(clearAllUserCaches).toHaveBeenCalled();
  });

  it('logs out cleanly when the post-deletion refresh fails transiently', async () => {
    // The group is already deleted server-side and its access token dropped, so
    // a transient (network / 5xx) refresh failure must not leave the app on the
    // now-deleted currentGroup. It should fall back to a clean logged-out state.
    mockRefresh.mockRejectedValue(new Error('network down'));

    function DeleteFlowConsumer() {
      const { onGroupDeleted, user: u, currentGroup: g } = useAuth();
      return (
        <div>
          <span data-testid="state">{u ? `user:${g ? g.name : 'no-group'}` : 'anon'}</span>
          <button onClick={() => onGroupDeleted()}>delete</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <DeleteFlowConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('user:Family');

    await act(async () => {
      screen.getByText('delete').click();
    });

    // Not stranded on the deleted group: fully logged out, token cleared.
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('anon'));
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('does not resurrect the session when a refresh resolves after logout', async () => {
    // Signing out while a POST /auth/refresh is in flight used to be undone by
    // that refresh: it landed a token good for another ~15 minutes and re-applied
    // the user. The session epoch must make the late result a no-op.
    let resolveRefresh!: (data: unknown) => void;
    mockRefresh.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );

    const logoutRef: { current: (() => Promise<void>) | null } = { current: null };
    function LogoutConsumer() {
      const { logout, user: u } = useAuth();
      useEffect(() => {
        logoutRef.current = logout;
      }, [logout]);
      return <span data-testid="status">{u ? `user:${u.name}` : 'anon'}</span>;
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('user:Tom');
    await act(async () => {});

    // Put a refresh in flight, then sign out before it comes back.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    await act(async () => {
      await logoutRef.current!();
    });
    expect(screen.getByTestId('status').textContent).toBe('anon');

    await act(async () => {
      resolveRefresh(refreshResponse);
      await Promise.resolve();
    });

    // Still signed out, and the late token was never persisted.
    expect(screen.getByTestId('status').textContent).toBe('anon');
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('closes the browser push subscription on logout', async () => {
    // Deleting only the backend row leaves a live PushSubscription on the
    // device, so the endpoint outlives the session.
    const subscriptionUnsubscribe = vi.fn().mockResolvedValue(true);
    const subscription = {
      endpoint: 'https://push.example/abc',
      unsubscribe: subscriptionUnsubscribe,
    };
    vi.stubGlobal('PushManager', class {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => subscription },
        }),
      },
    });

    const { api } = await import('../lib/api');
    const logoutRef: { current: (() => Promise<void>) | null } = { current: null };
    function LogoutConsumer() {
      const { logout } = useAuth();
      useEffect(() => {
        logoutRef.current = logout;
      }, [logout]);
      return null;
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(logoutRef.current).not.toBeNull());

    await act(async () => {
      await logoutRef.current!();
    });

    expect(api.push.unsubscribe).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscriptionUnsubscribe).toHaveBeenCalled();
  });

  it('clears the previous session caches before publishing a magic-link login', async () => {
    // User A -> user B via a magic link in the same browser: A's NetworkFirst
    // /users/me and photo-list entries must be gone before B's state lands,
    // otherwise the feed can serve A's content to B.
    let finishCacheClear!: () => void;
    vi.mocked(clearAllUserCaches).mockReturnValue(
      new Promise<void>((resolve) => {
        finishCacheClear = resolve;
      })
    );

    localStorage.removeItem('accessToken');
    mockGetMe.mockRejectedValue(new Error('no token'));
    mockRefresh.mockRejectedValue(new Error('no cookie'));

    const loginRef: { current: ReturnType<typeof useAuth>['login'] | null } = { current: null };
    function LoginConsumer() {
      const { login, user: u } = useAuth();
      useEffect(() => {
        loginRef.current = login;
      }, [login]);
      return <span data-testid="status">{u ? `user:${u.name}` : 'anon'}</span>;
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('anon');

    const otherUser = { ...user, id: 'u2', name: 'Ada', email: 'ada@example.com' };
    let published = false;
    let pending!: Promise<void>;
    act(() => {
      pending = loginRef.current!('b-token', otherUser, currentGroup, [currentGroup], false).then(
        () => {
          published = true;
        }
      );
    });

    await act(async () => {
      await Promise.resolve();
    });
    // Parked on the cache clear: neither the token nor the state is live yet.
    expect(published).toBe(false);
    expect(screen.getByTestId('status').textContent).toBe('anon');
    expect(localStorage.getItem('accessToken')).toBeNull();

    finishCacheClear();
    await act(async () => {
      await pending;
    });

    expect(screen.getByTestId('status').textContent).toBe('user:Ada');
    expect(localStorage.getItem('accessToken')).toBe('b-token');
  });

  it('keeps a stored token when the cold-start check cannot reach the server', async () => {
    // An offline launch of the installed PWA: getMe fails with a network error,
    // which says nothing about the session. Throwing the token away here signs
    // the user out permanently — nothing afterwards re-mints it.
    mockGetMe.mockRejectedValue(new TypeError('Failed to fetch'));
    mockRefresh.mockRejectedValue(new TypeError('Failed to fetch'));

    renderApp();
    await screen.findByText('anon');
    expect(localStorage.getItem('accessToken')).toBe('initial-token');

    // Connectivity returns: the bootstrap retries and the session comes back
    // without the user relaunching.
    mockGetMe.mockResolvedValue(meResponse);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await screen.findByText('user:Tom');
    expect(localStorage.getItem('accessToken')).toBe('initial-token');
  });

  it('drops the stored token when the server rejects it on cold start', async () => {
    // The contrast to the test above: a 401 is the server telling us the token
    // is dead, so it must not be kept.
    mockGetMe.mockRejectedValue(new ApiError(401, 'Unauthorized', 'Invalid token'));
    mockRefresh.mockRejectedValue(new ApiError(401, 'Unauthorized', 'Expired'));

    renderApp();
    await screen.findByText('anon');
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('mints a fresh selection token when the picker token has expired', async () => {
    // Selection tokens live ~5 minutes and the picker has no refresh of its own,
    // so without this every retry reuses the same dead token and the user is
    // stranded on the group picker.
    const otherGroup = { ...currentGroup, id: 'g2', name: 'Friends' };
    const pickerResponse = {
      accessToken: null,
      user,
      currentGroup: null,
      groups: [otherGroup],
      needsGroupSelection: true,
    };

    localStorage.removeItem('accessToken');
    mockGetMe.mockRejectedValue(new Error('no token'));
    mockRefresh
      .mockResolvedValueOnce({ ...pickerResponse, selectionToken: 'stale-selection-token' })
      .mockResolvedValueOnce({ ...pickerResponse, selectionToken: 'fresh-selection-token' });
    mockSelectGroup
      .mockRejectedValueOnce(new ApiError(401, 'Unauthorized', 'Selection token expired'))
      .mockResolvedValueOnce({
        accessToken: 'new-token',
        user,
        currentGroup: otherGroup,
        groups: [otherGroup],
      });

    function PickerConsumer() {
      const { selectGroup, currentGroup: g } = useAuth();
      return (
        <div>
          <span data-testid="group">{g ? g.name : 'no-group'}</span>
          <button onClick={() => selectGroup('g2').catch(() => {})}>pick</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <PickerConsumer />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByText('no-group');

    // First attempt uses the token the picker was handed, and fails.
    await act(async () => {
      screen.getByText('pick').click();
    });
    expect(mockSelectGroup).toHaveBeenNthCalledWith(1, 'stale-selection-token', 'g2');
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));

    // The retry the user makes next carries the freshly minted token.
    await act(async () => {
      screen.getByText('pick').click();
    });
    expect(mockSelectGroup).toHaveBeenNthCalledWith(2, 'fresh-selection-token', 'g2');
    await waitFor(() => expect(screen.getByTestId('group').textContent).toBe('Friends'));
  });

  it('syncs state from an API-driven token refresh event', async () => {
    localStorage.removeItem('accessToken');
    mockGetMe.mockRejectedValue(new Error('no token'));
    mockRefresh.mockRejectedValue(new Error('no cookie'));

    renderApp();
    await screen.findByText('anon');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('auth:token-refreshed', {
          detail: { accessToken: 'fresh', user, currentGroup, groups: [currentGroup] },
        })
      );
    });

    await screen.findByText('user:Tom');
  });
});
