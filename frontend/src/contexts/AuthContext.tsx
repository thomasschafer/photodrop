import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../lib/api';

interface User {
  id: string;
  name: string;
  role: 'admin' | 'viewer';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (accessToken: string, user: User) => void;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((accessToken: string, userData: User) => {
    localStorage.setItem('accessToken', accessToken);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('accessToken');
      setUser(null);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await api.auth.refresh();
      localStorage.setItem('accessToken', data.accessToken);
      setUser(data.user);
    } catch (error) {
      console.error('Refresh error:', error);
      localStorage.removeItem('accessToken');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');

      if (token) {
        try {
          const userData = await api.users.getMe();
          setUser({
            id: userData.id,
            name: userData.name,
            role: userData.role,
          });
        } catch {
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

  useEffect(() => {
    if (!user) return;

    const interval = setInterval(
      () => {
        refreshAuth();
      },
      14 * 60 * 1000
    );

    return () => clearInterval(interval);
  }, [user, refreshAuth]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshAuth }}>
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
