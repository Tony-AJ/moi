import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { EventScopeProvider } from '../lib/scope';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/entries', label: 'Moi entries' },
  { to: '/reconcile', label: 'Reconciliation' },
  { to: '/events', label: 'Events & QR' },
  { to: '/reports', label: 'Reports' },
];

export function AdminLayout() {
  const { admin, signOut } = useAuth();

  return (
    <EventScopeProvider>
      <div className="layout">
        <aside className="sidebar">
          <div>
            <div className="brand">MoiLedger</div>
            <div className="who">
              {admin?.name} &middot; {admin?.role}
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
