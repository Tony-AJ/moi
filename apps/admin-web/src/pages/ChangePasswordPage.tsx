import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

const MIN_LENGTH = 10;

/**
 * Forced on first sign-in with an issued password, and reachable any time
 * from the sidebar. Replacing the password is what makes a password that was
 * sent over WhatsApp or read out on a call stop working.
 */
export function ChangePasswordPage() {
  const { admin, setProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const forced = Boolean(admin?.mustChangePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError('Use at least ' + MIN_LENGTH + ' characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a password different from the current one.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      setProfile(result.profile);
      navigate('/', { replace: true });
    } catch (changeError) {
      setError(changeError instanceof ApiError ? changeError.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>{forced ? 'Set your password' : 'Change password'}</h1>

        {forced ? (
          <div className="alert info">
            Welcome{admin?.name ? ', ' + admin.name : ''}. You signed in with a one-time password.
            Choose your own to continue — the one-time password stops working once you do.
          </div>
        ) : null}

        {error ? <div className="alert err">{error}</div> : null}

        <div className="field">
          <label htmlFor="current">{forced ? 'One-time password' : 'Current password'}</label>
          <input
            id="current"
            type="password"
            value={currentPassword}
            onChange={(domEvent) => setCurrentPassword(domEvent.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="new">New password</label>
          <input
            id="new"
            type="password"
            value={newPassword}
            onChange={(domEvent) => setNewPassword(domEvent.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="confirm">Repeat new password</label>
          <input
            id="confirm"
            type="password"
            value={confirmPassword}
            onChange={(domEvent) => setConfirmPassword(domEvent.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Saving...' : 'Save password'}
        </button>

        <p className="muted" style={{ marginTop: 14, textAlign: 'center' }}>
          {forced ? (
            <button className="link-button" type="button" onClick={signOut}>
              Sign out instead
            </button>
          ) : (
            <Link to="/">Back</Link>
          )}
        </p>
      </form>
    </div>
  );
}
