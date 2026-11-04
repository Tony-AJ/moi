import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { actingWorkspace, isSuperAdmin } from '../lib/api';
import { EventScopeProvider } from '../lib/scope';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/entries', label: 'Moi entries' },
  { to: '/reconcile', label: 'Reconciliation' },
  { to: '/events', label: 'Event & QR' },
  { to: '/reports', label: 'Reports' },
  { to: '/activity', label: 'Activity' },
];

const ROLE_LABEL: Record<string, string> = {
  WORKSPACE_OWNER: 'Organizer',
  WORKSPACE_ADMIN: 'Co-organizer',
  EVENT_STAFF: 'Event staff',
};

export function AdminLayout() {
  const { admin, signOut } = useAuth();
  const navigate = useNavigate();
  const superAdmin = isSuperAdmin(admin);
  const acting = superAdmin ? actingWorkspace.get() : null;
  const membership = admin?.memberships[0];

  function backToConsole() {
    actingWorkspace.clear();
    navigate('/platform');
  }

  return (
    <EventScopeProvider>
      <div className="layout">
        <aside className="sidebar">
          <div>
            <div className="brand">MoiLedger</div>
            <div className="who">
              {admin?.name}
              {superAdmin
                ? ' · Super admin'
                : membership
                  ? ' · ' + (ROLE_LABEL[membership.role] ?? membership.role)
                  : ''}
              <div>{acting ? acting.name : membership?.workspaceName}</div>
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
          {superAdmin ? (
            <button className="signout" type="button" onClick={backToConsole}>
              &larr; Back to console
            </button>
          ) : null}
          <button className="signout" type="button" onClick={signOut}>
            Sign out
          </button>
        </aside>
        <main className="content">
          {acting ? (
            <div className="alert info">
              Super admin view of <strong>{acting.name}</strong>. Everything here is this
              organizer's data.
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </EventScopeProvider>
  );
}
