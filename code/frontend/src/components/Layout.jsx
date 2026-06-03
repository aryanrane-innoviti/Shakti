import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import GlobalLoader from './GlobalLoader.jsx';

/**
 * Role-aware navigation:
 *   SA    → Users, Vendors/Locations/SKUs (view), User Types + Backups
 *   ADMIN → every operational object + Change Log
 *
 * Anything outside the role's scope is hidden from the sidebar entirely;
 * the backend also enforces this so direct URLs return 403.
 */
const NAV = {
  SA: [
    { to: '/dashboard',  label: 'Dashboard' },
    { section: 'People' },
    { to: '/users',      label: 'Users' },
    { section: 'Operations' },
    { to: '/vendors',    label: 'Vendors' },
    { to: '/locations',  label: 'Locations' },
    { to: '/skus',       label: 'Innoviti SKUs' },
    { section: 'Governance' },
    { to: '/user-types', label: 'User Types' },
    { to: '/backups',    label: 'Backups' },
  ],
  ADMIN: [
    { to: '/dashboard', label: 'Dashboard' },
    { section: 'Operations' },
    { to: '/users',     label: 'Users' },
    { to: '/contacts',  label: 'Contacts' },
    { to: '/vendors',   label: 'Vendors' },
    { to: '/locations', label: 'Locations' },
    { section: 'Catalog' },
    { to: '/skus',                 label: 'Innoviti SKUs' },
    { to: '/vendor-skus',          label: 'Vendor SKUs' },
    { to: '/sku-types',            label: 'SKU Types' },
    { to: '/vendor-types',         label: 'Vendor Types' },
    { section: 'Stock' },
    { to: '/load-stock', label: 'Load Stock' },
    { to: '/stock',      label: 'View Stock' },
    { section: 'Audit' },
    { to: '/change-log', label: 'Change Log' },
  ],
  // ASO users see only the Audit screen (and the identity panel for sign-out).
  ASO: [
    { to: '/audit', label: 'Audit' },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const items = NAV[user?.user_type_code] || [];
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer when route changes
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mobileOpen]);

  return (
    <div className={`layout${mobileOpen ? ' drawer-open' : ''}`}>
      {/* Mobile top bar — only renders ≤768px */}
      <header className="mobile-topbar">
        <h1 className="brand">Shakti<span className="dot">.</span></h1>
        <button
          className="hamburger"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span className={`bar bar-1${mobileOpen ? ' open' : ''}`} />
          <span className={`bar bar-2${mobileOpen ? ' open' : ''}`} />
          <span className={`bar bar-3${mobileOpen ? ' open' : ''}`} />
        </button>
      </header>

      <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <h1 className="brand">Shakti<span className="dot">.</span></h1>
        <p className="brand-sub">Supply Chain Ops</p>
        <p className="brand-version">v{__APP_VERSION__}</p>

        {items.map((item, i) =>
          item.section ? (
            <div className="nav-section" key={`s-${i}`}>{item.section}</div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          )
        )}

        <div className="identity">
          <p className="who">{user?.first_name} {user?.last_name}</p>
          <span className="role">{user?.user_type_code}</span>
          <div className="email">{user?.email}</div>
          <button onClick={async () => { await logout(); navigate('/login'); }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Backdrop — only visible when drawer is open on mobile */}
      <div
        className={`drawer-backdrop${mobileOpen ? ' open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <main className="main">
        <GlobalLoader />
        <Outlet />
      </main>
    </div>
  );
}
