import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

function StatCard({ to, label, value, sub, accent = false }) {
  const Body = (
    <div className={`stat-card${accent ? ' accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="stat-link">{Body}</Link> : Body;
}

function relTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then(setData).catch((e) => setErr(e.data?.error || e.message));
  }, []);

  const isSA = user?.user_type_code === 'SA';
  const isAdmin = user?.user_type_code === 'ADMIN';

  if (err) return <div className="card"><p className="error-text">Could not load dashboard: {err}</p></div>;
  if (!data) return <div className="card"><p>Loading dashboard…</p></div>;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">{isSA ? 'Governance' : 'Operations'} · Overview</span>
          <h1>Welcome back, {user?.first_name}.</h1>
          <p className="meta">
            {isSA
              ? 'Governance view — user types, backups, and a quick read on the operational catalog below.'
              : 'Today, at a glance — every object you steward, totals first, recent changes second.'}
          </p>
        </div>
      </div>

      {/* Audit — reserved tab for the future audit module */}
      <div className="audit-tab" role="button" aria-disabled="true" title="Audit module ships in a later phase">
        <span className="audit-tab-label">Audit</span>
        <span className="audit-tab-status">Coming soon</span>
      </div>

      {/* ============ Primary stats ============ */}
      <div className="stat-grid">
        <StatCard
          to="/users" accent
          label="Total Users"
          value={data.users.total}
          sub={`${data.users.active} active · ${data.users.inactive} inactive`}
        />

        {isAdmin && (
          <>
            <StatCard
              to="/vendors"
              label="Vendors"
              value={data.vendors.total}
              sub={`${data.vendors.active} active · ${data.vendors.inactive} inactive`}
            />
            <StatCard to="/contacts"  label="Contacts"  value={data.contacts.total}  sub="across all vendors" />
            <StatCard to="/locations" label="Locations" value={data.locations.total} sub="warehouses & merchant sites" />
            <StatCard
              to="/skus"
              label="SKUs"
              value={data.skus.total}
              sub={`${data.skus.active} active · ${data.skus.inactive} inactive`}
            />
            <StatCard to="/terminal-parent-skus" label="Terminal Parent SKUs" value={data.parent_skus.total} sub="logical groupings" />
          </>
        )}

        {isSA && (
          <>
            <StatCard to="/user-types" accent label="User Types" value={data.user_types.total} sub="role taxonomy" />
            <StatCard to="/backups"    accent label="Backups"    value={data.backups?.count ?? 0} sub={data.backups?.latest_at ? `Latest: ${relTime(data.backups.latest_at)}` : 'No snapshots yet'} />
            <StatCard label="Vendors"   value={data.vendors.total}   sub={`${data.vendors.active} active`} />
            <StatCard label="Locations" value={data.locations.total} sub="warehouses & merchant sites" />
            <StatCard label="SKUs"      value={data.skus.total}      sub={`${data.skus.active} active`} />
          </>
        )}
      </div>

      {/* ============ Catalog stats (Admin) ============ */}
      {isAdmin && (
        <>
          <h2 className="section-title">Catalog taxonomy</h2>
          <div className="stat-grid small">
            <StatCard to="/sku-types"    label="SKU Types"    value={data.sku_types.total}    sub="created or seeded" />
            <StatCard to="/vendor-types" label="Vendor Types" value={data.vendor_types.total} sub="filing categories" />
            <StatCard to="/user-types"   label="User Types"   value={data.user_types.total}   sub="role taxonomy" />
          </div>
        </>
      )}

      {/* ============ Recent changes ============ */}
      <h2 className="section-title">Recent activity</h2>
      <div className="card table-wrap">
        {data.recent_changes.length === 0 ? (
          <div className="empty">
            <h4>Quiet so far.</h4>
            <p>No mutations have been recorded yet. Start creating objects and the trail will appear here.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Object</th>
                <th>ID</th>
                <th>Action</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_changes.map((c) => (
                <tr key={c.change_log_id}>
                  <td>{relTime(c.occurred_at)}</td>
                  <td>{c.object_type}</td>
                  <td>{c.object_id}</td>
                  <td><span className="badge purple">{c.action}</span></td>
                  <td>{c.actor_user_index || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isAdmin && (
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Link to="/change-log">View full change log →</Link>
          </div>
        )}
      </div>
    </>
  );
}
