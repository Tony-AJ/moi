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
import { api, auth as tokenStore, isSuperAdmin, type AdminProfile } from './api';

interface AuthState {
  admin: AdminProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AdminProfile>;
  signOut: () => void;
  /** Replaces the cached profile, e.g. after the password was changed. */
  setProfile: (profile: AdminProfile) => void;
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
    return result.admin;
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({ admin, loading, signIn, signOut, setProfile: setAdmin }),
    [admin, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/**
 * Signed-in users only. A user still holding an issued password is sent to
 * the change form first; the API enforces the same rule, this just avoids
 * rendering a page whose every request would be refused.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="spinner" />;
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

/** Platform console: super admins only. */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  if (!isSuperAdmin(admin)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Organizer screens need a workspace. A super admin with no membership of
 * their own belongs in the platform console, not on an empty dashboard.
 */
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const { admin, signOut } = useAuth();

  if (admin && admin.memberships.length === 0) {
    if (isSuperAdmin(admin)) return <Navigate to="/platform" replace />;
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>No event assigned</h1>
          <div className="alert info">
            Your login is active but is not linked to any event yet. Ask the platform
            administrator to assign you.
          </div>
          <button className="btn secondary" type="button" onClick={signOut} style={{ width: '100%' }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const suspended = admin?.memberships.every((m) => m.workspaceStatus !== 'ACTIVE');
  if (suspended) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>Access paused</h1>
          <div className="alert warn">
            {admin?.memberships[0]?.workspaceName} is currently suspended by the platform
            administrator. Contact them to restore access.
          </div>
          <button className="btn secondary" type="button" onClick={signOut} style={{ width: '100%' }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
