import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ApiError } from '../lib/api';

const mockGetMe = vi.fn();
const mockRefresh = vi.fn();

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
        selectGroup: vi.fn(),
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

const user = { id: 'u1', name: 'Tom', email: 'tom@example.com', profileColor: 'teal' };
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

describe('AuthProvider session resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('accessToken', 'initial-token');
    mockGetMe.mockResolvedValue(meResponse);
    mockRefresh.mockResolvedValue(refreshResponse);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('refreshes the session when the app returns to the foreground', async () => {
    renderApp();
    await screen.findByText('user:Tom');

    // Bootstrapping uses getMe, not refresh.
    expect(mockRefresh).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('throttles foreground refreshes that fire in quick succession', async () => {
    renderApp();
    await screen.findByText('user:Tom');

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The 30s throttle collapses the burst into a single refresh.
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('stays logged in when a foreground refresh fails transiently', async () => {
    renderApp();
    await screen.findByText('user:Tom');

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
    renderApp();
    await screen.findByText('user:Tom');

    mockRefresh.mockRejectedValue(new ApiError(401, 'Unauthorized', 'Expired'));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('clears state and routes to /login when the session expires', async () => {
    renderApp();
    await screen.findByText('user:Tom');

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
    renderApp('/auth/some-token');
    await screen.findByText('user:Tom');

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
    // State is cleared, but the route is left intact for the verify flow.
    expect(screen.getByTestId('path').textContent).toBe('/auth/some-token');
    expect(localStorage.getItem('accessToken')).toBeNull();
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
