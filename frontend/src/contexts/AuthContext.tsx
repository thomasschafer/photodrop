import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../lib/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Group {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

interface AuthState {
  user: User | null;
  currentGroup: Group | null;
  groups: Group[];
  needsGroupSelection: boolean;
}

interface AuthContextType {
  user: User | null;
  currentGroup: Group | null;
  groups: Group[];
  needsGroupSelection: boolean;
  loading: boolean;
  login: (
    accessToken: string | null,
    user: User,
    currentGroup: Group | null,
    groups: Group[],
    needsGroupSelection: boolean
  ) => void;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  switchGroup: (groupId: string) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    currentGroup: null,
    groups: [],
    needsGroupSelection: false,
  });
  const [loading, setLoading] = useState(true);

  const login = useCallback(
    (
      accessToken: string | null,
      user: User,
      currentGroup: Group | null,
      groups: Group[],
      needsGroupSelection: boolean
    ) => {
      if (accessToken) {
        localStorage.setItem('accessToken', accessToken);
      }
      setAuthState({
        user,
        currentGroup,
        groups,
        needsGroupSelection,
      });
    },
    []
  );

  const logout = useCallback(async () => {
    try {
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
      });
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await api.auth.refresh();
      localStorage.setItem('accessToken', data.accessToken);
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup,
        groups: data.groups,
        needsGroupSelection: false,
      });
    } catch (error) {
      console.error('Refresh error:', error);
      localStorage.removeItem('accessToken');
      setAuthState({
        user: null,
        currentGroup: null,
        groups: [],
        needsGroupSelection: false,
      });
    }
  }, []);

  const switchGroup = useCallback(async (groupId: string) => {
    try {
      const data = await api.auth.switchGroup(groupId);
      localStorage.setItem('accessToken', data.accessToken);
      setAuthState({
        user: data.user,
        currentGroup: data.currentGroup,
        groups: data.groups,
        needsGroupSelection: false,
      });
    } catch (error) {
      console.error('Switch group error:', error);
      throw error;
    }
  }, []);

  const selectGroup = useCallback(
    async (groupId: string) => {
      if (!authState.user) {
        throw new Error('No user logged in');
      }

      try {
        const data = await api.auth.selectGroup(authState.user.id, groupId);
        localStorage.setItem('accessToken', data.accessToken);
        setAuthState({
          user: data.user,
          currentGroup: data.currentGroup,
          groups: data.groups,
          needsGroupSelection: false,
        });
      } catch (error) {
        console.error('Select group error:', error);
        throw error;
      }
    },
    [authState.user]
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
            },
            currentGroup: userData.currentGroup,
            groups: userData.groups,
            needsGroupSelection: !userData.currentGroup,
          });
        } catch {
          // Token invalid, try to refresh
          try {
            await refreshAuth();
          } catch (refreshError) {
            console.error('Failed to refresh auth:', refreshError);
            localStorage.removeItem('accessToken');
          }
        }
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

  return (
    <AuthContext.Provider
      value={{
        user: authState.user,
        currentGroup: authState.currentGroup,
        groups: authState.groups,
        needsGroupSelection: authState.needsGroupSelection,
        loading,
        login,
        logout,
        refreshAuth,
        switchGroup,
        selectGroup,
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
