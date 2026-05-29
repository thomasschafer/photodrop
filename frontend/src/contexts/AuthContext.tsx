import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { api, type User, type Group, type AuthResponse } from '../lib/api';
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
  refreshAuth: () => Promise<void>;
  switchGroup: (groupId: string) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  onGroupDeleted: (deletedGroupId: string) => void;
  updateProfileColor: (color: ProfileColor) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    currentGroup: null,
    groups: [],
    needsGroupSelection: false,
    selectionToken: null,
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
      localStorage.removeItem('accessToken');
      setAuthState({
        user: null,
        currentGroup: null,
        groups: [],
        needsGroupSelection: false,
        selectionToken: null,
      });
      clearAllUserCaches();
      // Reset native push init flag so it re-initializes on next login
      nativePushInitialized.current = false;
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await api.auth.refresh();
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        localStorage.removeItem('accessToken');
      }
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup ?? null,
        groups: data.groups,
        needsGroupSelection:
          data.needsGroupSelection || (!data.currentGroup && data.groups.length > 0),
        selectionToken: data.selectionToken ?? null,
      });
    } catch (error) {
      console.error('Refresh error:', error);
      localStorage.removeItem('accessToken');
      setAuthState({
        user: null,
        currentGroup: null,
        groups: [],
        needsGroupSelection: false,
        selectionToken: null,
      });
    }
  }, []);

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

  const onGroupDeleted = useCallback(
    (deletedGroupId: string) => {
      const remainingGroups = authState.groups.filter((g) => g.id !== deletedGroupId);
      localStorage.removeItem('accessToken');
      setAuthState({
        user: authState.user,
        currentGroup: null,
        groups: remainingGroups,
        needsGroupSelection: remainingGroups.length > 0,
        selectionToken: null,
      });
    },
    [authState.groups, authState.user]
  );

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
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup ?? null,
        groups: data.groups ?? [],
        needsGroupSelection:
          data.needsGroupSelection || (!data.currentGroup && (data.groups?.length ?? 0) > 0),
        selectionToken: data.selectionToken ?? null,
      });
    };

    const handleSessionExpired = () => {
      localStorage.removeItem('accessToken');
      setAuthState({
        user: null,
        currentGroup: null,
        groups: [],
        needsGroupSelection: false,
        selectionToken: null,
      });
      clearAllUserCaches();
      nativePushInitialized.current = false;
      navigate('/login', { replace: true });
    };

    window.addEventListener('auth:token-refreshed', handleTokenRefreshed);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:token-refreshed', handleTokenRefreshed);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, [navigate]);

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

    let nativeListener: { remove: () => void } | undefined;
    if (isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) refreshOnForeground();
      }).then((handle) => {
        nativeListener = handle;
      });
    }

    return () => {
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
