import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { admin, signIn, loading } = useAuth();
  const location = useLocation() as { state?: { from?: string } };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="spinner" />;
  if (admin) return <Navigate to={location.state?.from ?? '/'} replace />;

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (signInError) {
      setError(
        signInError instanceof ApiError ? signInError.message : 'Could not sign in. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>MoiLedger Admin</h1>
        {error ? <div className="alert err">{error}</div> : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button className="btn" type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="muted" style={{ marginTop: 14, textAlign: 'center' }}>
          Organizer access only. Guest pages do not need a login.
        </p>
      </form>
    </div>
  );
}
