import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/platform', label: 'Organizers & events' },
  { to: '/change-password', label: 'Change password' },
];

export function PlatformLayout() {
  const { admin, signOut } = useAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div>
          <div className="brand">MoiLedger</div>
          <div className="who">
            {admin?.name} &middot; Super admin
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
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
  );
}
