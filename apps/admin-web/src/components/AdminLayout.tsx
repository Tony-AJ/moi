import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { EventScopeProvider } from '../lib/scope';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/entries', label: 'Moi entries' },
  { to: '/reconcile', label: 'Reconciliation' },
  { to: '/events', label: 'Event & QR' },
  { to: '/reports', label: 'Reports' },
  { to: '/activity', label: 'Activity' },
  { to: '/change-password', label: 'Change password' },
];

const ROLE_LABEL: Record<string, string> = {
  WORKSPACE_OWNER: 'Organizer',
  WORKSPACE_ADMIN: 'Co-organizer',
  EVENT_STAFF: 'Event staff',
};

export function AdminLayout() {
  const { admin, signOut } = useAuth();
  const membership = admin?.memberships[0];

  return (
    <EventScopeProvider>
      <div className="layout">
        <aside className="sidebar">
          <div>
            <div className="brand">MoiLedger</div>
            <div className="who">
              {admin?.name}
              {membership
                ? ' · ' + (ROLE_LABEL[membership.role] ?? membership.role)
                : ''}
              {membership ? <div>{membership.workspaceName}</div> : null}
            </div>
          </div>
          <nav>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button className="signout" type="button" onClick={signOut}>
            Sign out
          </button>
        </aside>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </EventScopeProvider>
  );
}
