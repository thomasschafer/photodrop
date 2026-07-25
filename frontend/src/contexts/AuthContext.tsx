import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { api, isSessionExpired, type User, type Group, type AuthResponse } from '../lib/api';
import { clearAllUserCaches, clearGroupCaches } from '../lib/cache';
import type { ProfileColor } from '../lib/profileColors';
import {
  isNativePlatform,
  initializeNativePush,
  cleanupOnLogout as cleanupNativePush,
  onGroupSwitch as nativePushGroupSwitch,
} from '../lib/nativePush';
import { setNativeScreenshotProtection } from '../lib/privacyScreen';

interface AuthState {
  user: User | null;
  currentGroup: Group | null;
  groups: Group[];
  needsGroupSelection: boolean;
  selectionToken: string | null;
}

const LOGGED_OUT_STATE: AuthState = {
  user: null,
  currentGroup: null,
  groups: [],
  needsGroupSelection: false,
  selectionToken: null,
};

// Maps a /auth/refresh response (whether returned directly or delivered via the
// auth:token-refreshed event) to auth state. A valid session with no active
// group surfaces the group picker rather than logging the user out.
function refreshedAuthState(data: AuthResponse): AuthState {
  return {
    user: data.user,
    currentGroup: data.currentGroup ?? null,
    groups: data.groups,
    needsGroupSelection:
      (data.needsGroupSelection ?? false) || (!data.currentGroup && data.groups.length > 0),
    selectionToken: data.selectionToken ?? null,
  };
}

interface AuthContextType {
  user: User | null;
  currentGroup: Group | null;
  groups: Group[];
  needsGroupSelection: boolean;
  loading: boolean;
  imageProtection: boolean;
  login: (
    accessToken: string | null,
    user: User,
    currentGroup: Group | null,
    groups: Group[],
    needsGroupSelection: boolean,
    selectionToken?: string | null
  ) => void;
  logout: () => Promise<void>;
  // Resolves true when it settled auth state (synced from the server, or tore
  // down on a genuine expiry); false when a transient failure left the existing
  // state untouched. See onGroupDeleted for why the caller needs to know.
  refreshAuth: () => Promise<boolean>;
  switchGroup: (groupId: string) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  onGroupDeleted: () => Promise<void>;
  updateProfileColor: (color: ProfileColor) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(LOGGED_OUT_STATE);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Current pathname via a ref so event-driven callbacks read it fresh without
  // re-subscribing on every navigation.
  const pathname = useLocation().pathname;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Track if native push has been initialized (to avoid double init)
  const nativePushInitialized = useRef(false);
  const [imageProtection, setImageProtectionState] = useState(true);
  // Throttle foreground-triggered refreshes so visibility + native app-state
  // events don't fire two refreshes back to back.
  const lastForegroundRefresh = useRef(0);

  const login = useCallback(
    (
      accessToken: string | null,
      user: User,
      currentGroup: Group | null,
      groups: Group[],
      needsGroupSelection: boolean,
      selectionToken?: string | null
    ) => {
      if (accessToken) {
        localStorage.setItem('accessToken', accessToken);
      }
      setAuthState({
        user,
        currentGroup,
        groups,
        needsGroupSelection,
        selectionToken: selectionToken ?? null,
      });
    },
    []
  );

  // The single teardown for "this session is over": explicit logout, a refresh
  // the server rejected, the session-expired event, and the post-group-deletion
  // fallback must all leave exactly the same state behind. Clearing the caches
  // matters most — they hold another session's photos — and resetting the push
  // flag is what lets native push register again on the next sign-in.
  const resetToLoggedOut = useCallback(() => {
    localStorage.removeItem('accessToken');
    setAuthState(LOGGED_OUT_STATE);
    clearAllUserCaches();
    nativePushInitialized.current = false;
  }, []);

  const logout = useCallback(async () => {
    try {
      // Clean up web push subscriptions
      if (navigator.serviceWorker && window.PushManager) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await api.push.unsubscribe(subscription.endpoint);
          }
        } catch (pushError) {
          console.error('Error cleaning up push subscription:', pushError);
        }
      }

      // Clean up native push
      if (isNativePlatform()) {
        try {
          await cleanupNativePush();
        } catch (nativePushError) {
          console.error('Error cleaning up native push:', nativePushError);
        }
      }

      await api.auth.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      resetToLoggedOut();
    }
  }, [resetToLoggedOut]);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const data = await api.auth.refresh();
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        localStorage.removeItem('accessToken');
      }
      setAuthState(refreshedAuthState(data));
      return true;
    } catch (error) {
      console.error('Refresh error:', error);
      // A transient failure (network / 5xx) must not sign the user out — keep
      // the current session so a later refresh can recover. Only tear down on a
      // genuine expiry (the server rejected the refresh cookie).
      if (!isSessionExpired(error)) {
        return false;
      }
      resetToLoggedOut();
      return true;
    }
  }, [resetToLoggedOut]);

  const switchGroup = useCallback(async (groupId: string) => {
    try {
      const data = await api.auth.switchGroup(groupId);
      if (!data.accessToken) {
        throw new Error('No access token received from switchGroup');
      }
      localStorage.setItem('accessToken', data.accessToken);
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup ?? null,
        groups: data.groups,
        needsGroupSelection: false,
        selectionToken: null,
      });
      clearGroupCaches();

      // Re-register native push for new group
      if (isNativePlatform()) {
        nativePushGroupSwitch().catch((error) => {
          console.error('Error re-registering native push for new group:', error);
        });
      }
    } catch (error) {
      console.error('Switch group error:', error);
      throw error;
    }
  }, []);

  const selectGroup = useCallback(
    async (groupId: string) => {
      if (!authState.selectionToken) {
        throw new Error('No selection token available');
      }

      try {
        const data = await api.auth.selectGroup(authState.selectionToken, groupId);
        if (!data.accessToken) {
          throw new Error('No access token received from selectGroup');
        }
        localStorage.setItem('accessToken', data.accessToken);
        setAuthState({
          user: data.user,
          currentGroup: data.currentGroup ?? null,
          groups: data.groups,
          needsGroupSelection: false,
          selectionToken: null,
        });
        clearGroupCaches();
      } catch (error) {
        console.error('Select group error:', error);
        throw error;
      }
    },
    [authState.selectionToken]
  );

  const updateProfileColor = useCallback((color: ProfileColor) => {
    setAuthState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, profileColor: color } : null,
    }));
  }, []);

  // After the current group is deleted, the access token is dead (it's scoped
  // to that group). Refresh instead of patching state locally: the refresh
  // endpoint sees the missing membership and returns the remaining groups plus
  // the selection token the group picker needs — without it, selecting a new
  // group would fail.
  const onGroupDeleted = useCallback(async () => {
    localStorage.removeItem('accessToken');
    const settled = await refreshAuth();
    // If the refresh failed transiently (network / 5xx), refreshAuth leaves the
    // prior state untouched — but here that state names the group we just
    // deleted, and its token is already gone. Rather than strand a broken
    // session (stale currentGroup, no token, MembersList wedged mid-delete),
    // tear down to a clean logged-out state; the user re-authenticates and is
    // routed to the picker or their remaining group from there.
    if (!settled) {
      resetToLoggedOut();
    }
  }, [refreshAuth, resetToLoggedOut]);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');

      if (token) {
        try {
          // Try to get current user data
          const userData = await api.users.getMe();
          setAuthState({
            user: {
              id: userData.id,
              name: userData.name,
              email: userData.email,
              profileColor: userData.profileColor,
            },
            currentGroup: userData.currentGroup,
            groups: userData.groups,
            needsGroupSelection: !userData.currentGroup,
            selectionToken: null,
          });
          setLoading(false);
          return;
        } catch {
          // Token invalid, will try to refresh below
          localStorage.removeItem('accessToken');
        }
      }

      // No token or token invalid - try to refresh using httpOnly cookie
      try {
        await refreshAuth();
      } catch {
        // No valid session
      }

      setLoading(false);
    };

    initAuth();
  }, [refreshAuth]);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!authState.user || !authState.currentGroup) return;

    const interval = setInterval(
      () => {
        refreshAuth();
      },
      14 * 60 * 1000 // 14 minutes
    );

    return () => clearInterval(interval);
  }, [authState.user, authState.currentGroup, refreshAuth]);

  // Keep auth state in sync when the API layer transparently refreshes the
  // access token after a 401, and tear down + route to login when the refresh
  // token itself is gone (the session has genuinely expired).
  useEffect(() => {
    const handleTokenRefreshed = (e: Event) => {
      const data = (e as CustomEvent<AuthResponse>).detail;
      if (!data?.user) return;
      setAuthState(refreshedAuthState(data));
    };

    const handleSessionExpired = () => {
      resetToLoggedOut();
      // Don't redirect away from an in-progress magic-link verification: the
      // verify page owns that flow. Otherwise a stale session in the same
      // browser (e.g. after being removed from a group) would bounce the user
      // to /login instead of letting them sign in via the link they clicked.
      if (!pathnameRef.current.startsWith('/auth/')) {
        navigate('/login', { replace: true });
      }
    };

    window.addEventListener('auth:token-refreshed', handleTokenRefreshed);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:token-refreshed', handleTokenRefreshed);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, [navigate, resetToLoggedOut]);

  // Refresh proactively when the app returns to the foreground. iOS freezes
  // background timers, so the 14-minute interval above can't be relied on for
  // PWAs/tabs that get suspended — without this, the access token can expire
  // while backgrounded and every request fails until the app is restarted.
  useEffect(() => {
    if (!authState.user) return;

    const refreshOnForeground = () => {
      const now = Date.now();
      if (now - lastForegroundRefresh.current < 30 * 1000) return;
      lastForegroundRefresh.current = now;
      refreshAuth();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshOnForeground();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // CapApp.addListener resolves asynchronously. If this effect is cleaned up
    // (re-run on auth change, or unmount) before the handle arrives, remove it
    // on resolution instead — otherwise the listener leaks and keeps firing.
    let nativeListener: { remove: () => void } | undefined;
    let cancelled = false;
    if (isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) refreshOnForeground();
      }).then((handle) => {
        if (cancelled) handle.remove();
        else nativeListener = handle;
      });
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      nativeListener?.remove();
    };
  }, [authState.user, refreshAuth]);

  // Initialize native push notifications when authenticated with a group
  useEffect(() => {
    if (!authState.user || !authState.currentGroup || !isNativePlatform()) return;
    if (nativePushInitialized.current) return;

    nativePushInitialized.current = true;
    initializeNativePush().catch((error) => {
      console.error('Error initializing native push:', error);
      nativePushInitialized.current = false;
    });
  }, [authState.user, authState.currentGroup]);

  // Update privacy screen protection when current group changes
  useEffect(() => {
    if (!authState.currentGroup) return;
    const enabled = authState.currentGroup.imageProtection;
    setImageProtectionState(enabled);
    setNativeScreenshotProtection(enabled).catch((error) => {
      console.error('Failed to update image protection:', error);
    });
  }, [authState.currentGroup]);

  // Listen for image protection changes from settings toggle
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      setImageProtectionState(detail.enabled);
      setAuthState((prev) => {
        if (!prev.currentGroup) return prev;
        return {
          ...prev,
          currentGroup: { ...prev.currentGroup, imageProtection: detail.enabled },
          groups: prev.groups.map((g) =>
            g.id === prev.currentGroup!.id ? { ...g, imageProtection: detail.enabled } : g
          ),
        };
      });
    };
    window.addEventListener('imageProtectionChanged', handler);
    return () => window.removeEventListener('imageProtectionChanged', handler);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: authState.user,
        currentGroup: authState.currentGroup,
        groups: authState.groups,
        needsGroupSelection: authState.needsGroupSelection,
        loading,
        imageProtection,
        login,
        logout,
        refreshAuth,
        switchGroup,
        selectGroup,
        onGroupDeleted,
        updateProfileColor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
