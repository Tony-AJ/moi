import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, auth as tokenStore, type AdminProfile } from './api';

interface AuthState {
  admin: AdminProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.token) {
      setLoading(false);
      return;
    }
    // The stored token is only trusted after the API confirms it.
    api
      .me()
      .then(setAdmin)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    tokenStore.set(result.accessToken);
    setAdmin(result.admin);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({ admin, loading, signIn, signOut }),
    [admin, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="spinner" />;
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
