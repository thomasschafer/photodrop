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
import {
  api,
  isSessionExpired,
  getSessionEpoch,
  bumpSessionEpoch,
  type User,
  type Group,
  type AuthResponse,
} from '../lib/api';
import { clearAllUserCaches, clearGroupCaches } from '../lib/cache';
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
  // Async because it must finish clearing the previous session's caches before
  // the new auth state is published; callers should await it before navigating.
  login: (
    accessToken: string | null,
    user: User,
    currentGroup: Group | null,
    groups: Group[],
    needsGroupSelection: boolean,
    selectionToken?: string | null
  ) => Promise<void>;
  logout: () => Promise<void>;
  // Resolves true when it settled auth state (synced from the server, or tore
  // down on a genuine expiry); false when a transient failure left the existing
  // state untouched. See onGroupDeleted for why the caller needs to know.
  refreshAuth: () => Promise<boolean>;
  switchGroup: (groupId: string) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  onGroupDeleted: () => Promise<void>;
  leaveGroup: () => Promise<void>;
  /** Apply an already-persisted change to the signed-in user's own profile. */
  updateProfile: (update: ProfileUpdate) => void;
}

type ProfileUpdate = Partial<Pick<User, 'name' | 'profileColor'>>;

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
    async (
      accessToken: string | null,
      user: User,
      currentGroup: Group | null,
      groups: Group[],
      needsGroupSelection: boolean,
      selectionToken?: string | null
    ) => {
      // Any /auth/refresh still in flight belongs to the session we just
      // replaced; invalidate it so it can't write its token over the new one.
      // First, before anything is awaited: a refresh resolving during the cache
      // clear below would still see the old epoch and apply its result, and
      // when the new session carries no token of its own (accessToken === null,
      // the group-selection case) nothing later overwrites the key it wrote.
      bumpSessionEpoch();
      // A magic link can sign a *different* person in on a browser that still
      // holds the previous user's caches: photodrop:user:api and
      // photodrop:group:photo-list are NetworkFirst, so without this the new
      // user can be served the old user's /users/me and photo list. Cleared
      // before publishing the new state for the same reason switchGroup does
      // it in that order — once the state lands the feed starts fetching, and a
      // clear running behind that would delete the new session's fresh entries.
      await clearAllUserCaches();
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
  //
  // Awaited rather than fire-and-forget: clearAllUserCaches only drops the
  // in-memory image cache after the Cache API deletion resolves, so ignoring
  // the promise would let teardown "finish" with decoded photos still held.
  const resetToLoggedOut = useCallback(async () => {
    // Retire the session generation first: a POST /auth/refresh already in
    // flight would otherwise resolve after this teardown and write a fresh
    // token back, silently signing the user in again for another ~15 minutes.
    // Every refresh path re-checks the epoch before applying its result.
    bumpSessionEpoch();
    localStorage.removeItem('accessToken');
    setAuthState(LOGGED_OUT_STATE);
    nativePushInitialized.current = false;
    await clearAllUserCaches();
  }, []);

  const logout = useCallback(async () => {
    try {
      // Clean up web push subscriptions
      if (navigator.serviceWorker && window.PushManager) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            try {
              await api.push.unsubscribe(subscription.endpoint);
            } finally {
              // Close the browser-side channel too, whatever the backend call
              // did. Deleting only the backend row leaves a live
              // PushSubscription on this device, so the endpoint outlives the
              // session and the next person to sign in here inherits it instead
              // of registering their own — and that must not hinge on a network
              // request succeeding.
              await subscription.unsubscribe();
            }
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
      await resetToLoggedOut();
    }
  }, [resetToLoggedOut]);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    // Captured before awaiting: if the session is torn down while this refresh
    // is in the air, the epoch moves and neither the success nor the failure
    // path below may touch auth state. Auth state *is* settled in that case —
    // logged out — so both report true.
    const epoch = getSessionEpoch();
    try {
      const data = await api.auth.refresh();
      if (epoch !== getSessionEpoch()) {
        return true;
      }
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        localStorage.removeItem('accessToken');
      }
      setAuthState(refreshedAuthState(data));
      return true;
    } catch (error) {
      if (epoch !== getSessionEpoch()) {
        return true;
      }
      // A transient failure (network / 5xx) must not sign the user out — keep
      // the current session so a later refresh can recover. Only tear down on a
      // genuine expiry (the server rejected the refresh cookie).
      if (!isSessionExpired(error)) {
        console.error('Refresh error:', error);
        return false;
      }
      await resetToLoggedOut();
      return true;
    }
  }, [resetToLoggedOut]);

  const switchGroup = useCallback(async (groupId: string) => {
    try {
      const data = await api.auth.switchGroup(groupId);
      if (!data.accessToken) {
        throw new Error('No access token received from switchGroup');
      }
      // Before publishing the new group, not after: once the state switches,
      // the feed starts fetching and caching the new group's photos, and a
      // clear running behind that would both serve the old group's images
      // briefly and delete the new group's freshly cached ones.
      await clearGroupCaches();
      localStorage.setItem('accessToken', data.accessToken);
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup ?? null,
        groups: data.groups,
        needsGroupSelection: false,
        selectionToken: null,
      });

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
        // Cleared before publishing, as in switchGroup above.
        await clearGroupCaches();
        localStorage.setItem('accessToken', data.accessToken);
        setAuthState({
          user: data.user,
          currentGroup: data.currentGroup ?? null,
          groups: data.groups,
          needsGroupSelection: false,
          selectionToken: null,
        });
      } catch (error) {
        console.error('Select group error:', error);
        // Selection tokens live ~5 minutes and the picker has no refresh of its
        // own (the interval refresh needs a currentGroup, which is exactly what
        // this user lacks). Once the token dies, every retry reuses the same
        // dead one and the user is stranded. Re-refresh to mint a fresh
        // selection token so the retry they're about to make can succeed; a
        // genuinely dead session tears down through refreshAuth as usual.
        if (isSessionExpired(error)) {
          await refreshAuth();
        }
        throw error;
      }
    },
    [authState.selectionToken, refreshAuth]
  );

  const updateProfile = useCallback((update: ProfileUpdate) => {
    setAuthState((prev) => (prev.user ? { ...prev, user: { ...prev.user, ...update } } : prev));
  }, []);

  const settleAfterGroupAccessEnds = useCallback(
    async (clearDepartedGroupCaches: boolean) => {
      localStorage.removeItem('accessToken');
      if (clearDepartedGroupCaches) {
        await clearGroupCaches();
      }
      const settled = await refreshAuth();
      if (!settled) {
        await resetToLoggedOut();
      }
    },
    [refreshAuth, resetToLoggedOut]
  );

  // After the current group is deleted, the access token is dead (it's scoped
  // to that group). Refresh instead of patching state locally: the refresh
  // endpoint sees the missing membership and returns the remaining groups plus
  // the selection token the group picker needs — without it, selecting a new
  // group would fail. If refresh fails transiently, settleAfterGroupAccessEnds
  // tears down rather than leaving a stale group with no usable token.
  const onGroupDeleted = useCallback(async () => {
    await settleAfterGroupAccessEnds(false);
  }, [settleAfterGroupAccessEnds]);

  const leaveGroup = useCallback(async () => {
    if (!authState.currentGroup) return;
    await api.groups.leave(authState.currentGroup.id);
    await settleAfterGroupAccessEnds(true);
  }, [authState.currentGroup, settleAfterGroupAccessEnds]);

  useEffect(() => {
    let cancelled = false;
    let retryWhenOnline: (() => void) | null = null;

    // Resolves true once auth state is settled (signed in, or genuinely signed
    // out); false when the attempt failed transiently and we simply don't know
    // yet — see the retry below.
    const bootstrapAuth = async (): Promise<boolean> => {
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
          return true;
        } catch (error) {
          // Only the server explicitly rejecting the token (401/403) proves it
          // is dead. Opening the installed PWA with no connectivity fails here
          // too, and discarding a perfectly good token for that would sign the
          // user out permanently — the refresh below fails for the same reason,
          // and nothing afterwards re-mints it. Keep the token in that case.
          if (!isSessionExpired(error)) {
            console.error('Could not verify the stored session:', error);
            return false;
          }
          localStorage.removeItem('accessToken');
        }
      }

      // No token, or the server rejected it — fall back to the httpOnly refresh
      // cookie. refreshAuth applies the same rule and reports false when it
      // couldn't tell either.
      return refreshAuth();
    };

    const run = async () => {
      const settled = await bootstrapAuth();
      if (cancelled) return;
      setLoading(false);
      if (settled) return;

      // Bootstrap couldn't reach the server. Retry when connectivity returns so
      // a session that only failed to verify offline is restored without the
      // user having to relaunch the app.
      retryWhenOnline = () => {
        retryWhenOnline = null;
        void run();
      };
      window.addEventListener('online', retryWhenOnline, { once: true });
    };

    void run();

    return () => {
      cancelled = true;
      if (retryWhenOnline) {
        window.removeEventListener('online', retryWhenOnline);
      }
    };
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

    const handleSessionExpired = async () => {
      await resetToLoggedOut();
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
        leaveGroup,
        updateProfile,
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
