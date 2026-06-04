import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

/**
 * Phase 3 (Report slice) — Audit Reports listing.
 *
 * Thin client over GET /audit-reports. STU is the reviewer; SA / Admin get
 * read-only oversight (the row actions live on the detail screen). Status +
 * date filters are sent to the API; the text box filters the current page
 * client-side (so the screen needs no /users or /locations access that a STU
 * may not have).
 */

// UI status label -> .badge colour class (see styles.css).
const STATUS_BADGE = {
  Pending: 'warn',       // amber — awaiting reviewer
  Incomplete: 'plain',   // grey — auditor hasn't completed
  Approved: 'active',    // green
  Rejected: 'inactive',  // red
};
const STATUS_FILTERS = ['Pending', 'Incomplete', 'Approved', 'Rejected'];
const PAGE_SIZE = 25;

const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

function StatusPill({ status }) {
  return <span className={`badge ${STATUS_BADGE[status] || 'plain'} sm`}>{status}</span>;
}

export default function AuditReports() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState([]); // selected UI labels
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = [`page=${page}`, `page_size=${PAGE_SIZE}`];
    if (statuses.length) params.push(`status=${encodeURIComponent(statuses.join(','))}`);
    if (dateFrom) params.push(`started_at_from=${encodeURIComponent(dateFrom)}`);
    if (dateTo) params.push(`started_at_to=${encodeURIComponent(dateTo)}`);
    try {
      const res = await api.get(`/audit-reports?${params.join('&')}`);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      setItems([]);
      setTotal(0);
      toast.push(e.data?.error || e.message || 'Failed to load audit reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statuses, dateFrom, dateTo, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Changing a filter resets to page 1.
  const toggleStatus = (label) => {
    setPage(1);
    setStatuses((prev) => (prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]));
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      [r.audit_index, r.location_name, `${r.auditor_first_name} ${r.auditor_last_name}`, r.auditor_user_index]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [items, search]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <div className="page-header"><h2>Audit Reports</h2></div>

      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((label) => (
            <button
              key={label}
              type="button"
              className={statuses.includes(label) ? 'primary' : ''}
              onClick={() => toggleStatus(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          From
          <input type="date" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          To
          <input type="date" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value); }} />
        </label>
        <input
          placeholder="Search AIN / auditor / location"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr>
            <th>PAR (AIN)</th>
            <th>Auditor</th>
            <th>Role</th>
            <th>Location</th>
            <th>Created</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>Loading…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>No audit reports.</td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.audit_index}>
                <td><Link to={`/audit-reports/${r.audit_index}`}><code>{r.audit_index}</code></Link></td>
                <td>
                  {`${r.auditor_first_name || ''} ${r.auditor_last_name || ''}`.trim() || '—'}
                  {r.auditor_user_index && <span className="muted"> · {r.auditor_user_index}</span>}
                </td>
                <td><span className="badge plain sm">{r.auditor_role}</span></td>
                <td>{r.location_name || '—'}</td>
                <td>{fmtDateTime(r.created_at)}</td>
                <td><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
        <span className="muted">
          {total === 0 ? '0 reports' : `${rangeFrom}–${rangeTo} of ${total}`} · page {page}/{lastPage}
        </span>
        <button disabled={page >= lastPage || loading} onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>Next →</button>
      </div>
    </>
  );
}
