import { useEffect, useMemo, useState, Fragment } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

/**
 * View Stock — read-only browse over the Phase 2 master tables.
 *
 * Payment Terminal / Base Station units belong to a Vendor SKU, and one
 * Vendor SKU may supply several Innoviti SKUs. The roll-up therefore shows
 * one row per (Innoviti SKU x Vendor SKU) pairing: a shared Vendor SKU's
 * units are counted under every Innoviti SKU it feeds. So the page reports
 * two totals — "logical" (per-Innoviti-SKU, double-counts shared units) and
 * "physical" (distinct units, collapsed on Vendor SKU).
 *
 * SIM Cards have no Vendor SKU layer: each row is one Innoviti SKU and the
 * logical and physical totals are the same.
 */
const KINDS = {
  payment_terminal: {
    label: 'Payment Terminals', slug: 'payment-terminals', indexLabel: 'Serial Number',
    hasOwner: true, hasDate: true, hasVendorSku: true,
    states: ['Working', 'Retrieved', 'Installed', 'In Repair', 'In Transit', 'Scrapped', 'Lost'],
  },
  sim_card: {
    label: 'SIM Cards', slug: 'sim-cards', indexLabel: 'SIM Number',
    hasOwner: false, hasDate: false, hasVendorSku: false,
    states: ['Inactive', 'Active', 'Blocked', 'Lost'],
  },
  base_station: {
    label: 'Base Stations', slug: 'base-stations', indexLabel: 'Serial Number',
    hasOwner: true, hasDate: true, hasVendorSku: true,
    states: ['Working', 'Retrieved', 'Installed', 'In Repair', 'In Transit', 'Scrapped', 'Lost'],
  },
};

const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');

function StateBreakdown({ byState }) {
  const entries = Object.entries(byState || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="muted">—</span>;
  return (
    <span className="stock-states">
      {entries.map(([s, n]) => (
        <span key={s} className="badge plain sm">{s} {n}</span>
      ))}
    </span>
  );
}

export default function Stock() {
  const toast = useToast();
  const [kind, setKind] = useState('payment_terminal');
  const [summary, setSummary] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [filter, setFilter] = useState({ state: '', owner_vendor_id: '' });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});   // groupKey -> bool
  const [details, setDetails] = useState({});     // groupKey -> 'loading' | rows[]
  const def = KINDS[kind];

  useEffect(() => { api.get('/vendors').then(setVendors).catch(() => {}); }, []);

  const filterQuery = () => Object.entries(filter)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  useEffect(() => {
    setLoading(true);
    setExpanded({});
    setDetails({});
    const q = filterQuery();
    api.get(`/stock/${def.slug}/summary` + (q ? `?${q}` : ''))
      .then(setSummary)
      .catch((e) => {
        setSummary([]);
        toast.push(e.data?.error || e.message || 'Failed to load stock', 'error');
      })
      .finally(() => setLoading(false));
  }, [kind, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchKind = (k) => {
    if (k === kind) return;
    setKind(k);
    setFilter({ state: '', owner_vendor_id: '' });
    setSearch('');
  };

  const groupKey = (r) => `${r.sku_id ?? ''}::${r.vendor_sku_id ?? ''}`;

  const toggle = (r) => {
    const key = groupKey(r);
    const isOpen = !!expanded[key];
    setExpanded((p) => ({ ...p, [key]: !isOpen }));
    if (!isOpen && details[key] === undefined) {
      setDetails((p) => ({ ...p, [key]: 'loading' }));
      // PT/BS units are fetched by vendor SKU (the unit's anchor); SIM by SKU.
      const parts = [];
      if (def.hasVendorSku) {
        parts.push(`vendor_sku_id=${encodeURIComponent(r.vendor_sku_id ?? 'null')}`);
      } else {
        parts.push(`sku_id=${r.sku_id}`);
      }
      const fq = filterQuery();
      if (fq) parts.push(fq);
      api.get(`/stock/${def.slug}?${parts.join('&')}`)
        .then((rows) => setDetails((p) => ({ ...p, [key]: rows })))
        .catch((e) => {
          setDetails((p) => ({ ...p, [key]: [] }));
          toast.push(e.data?.error || e.message || 'Failed to load units', 'error');
        });
    }
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return summary;
    return summary.filter((r) =>
      [r.sku_number, r.sku_name, r.vendor_sku_number]
        .some((v) => String(v || '').toLowerCase().includes(s))
    );
  }, [summary, search]);

  // Logical total double-counts a shared vendor SKU; physical collapses on it.
  const logicalTotal = visible.reduce((a, r) => a + r.total, 0);
  const physicalTotal = useMemo(() => {
    const byVsku = new Map();
    for (const r of visible) {
      const k = r.vendor_sku_id ?? `nosku-${r.sku_id ?? 'none'}`;
      byVsku.set(k, r.total);
    }
    return [...byVsku.values()].reduce((a, b) => a + b, 0);
  }, [visible]);

  // Per-Innoviti-SKU logical subtotal.
  const skuTotals = useMemo(() => {
    const m = new Map();
    for (const r of visible) m.set(r.sku_id, (m.get(r.sku_id) || 0) + r.total);
    return m;
  }, [visible]);

  const colCount = def.hasVendorSku ? 5 : 4;

  return (
    <>
      <div className="page-header"><h2>View Stock</h2></div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(KINDS).map(([k, d]) => (
          <button key={k} className={k === kind ? 'primary' : ''} onClick={() => switchKind(k)}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <select value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value })}>
          <option value="">Any state</option>
          {def.states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {def.hasOwner && (
          <select
            value={filter.owner_vendor_id}
            onChange={(e) => setFilter({ ...filter, owner_vendor_id: e.target.value })}
          >
            <option value="">Any owner</option>
            {vendors.map((v) => (
              <option key={v.vendor_id} value={v.vendor_id}>{v.company_name}</option>
            ))}
          </select>
        )}
        <input
          placeholder={def.hasVendorSku ? 'Search Innoviti / Vendor SKU' : 'Search SKU / name'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card table-wrap">
        <p className="help-text" style={{ marginTop: 0 }}>
          {def.hasVendorSku ? (
            <>
              Each row is an Innoviti SKU × Vendor SKU pairing — click it to see the individual
              units. <strong>{physicalTotal}</strong> physical unit{physicalTotal === 1 ? '' : 's'}
              {' · '}<strong>{logicalTotal}</strong> logical (a Vendor SKU shared by several Innoviti
              SKUs is counted under each).
            </>
          ) : (
            <>
              Each row is an Innoviti SKU — click it to see the individual units.
              {' '}<strong>{logicalTotal}</strong> unit{logicalTotal === 1 ? '' : 's'} across{' '}
              {visible.length} SKU{visible.length === 1 ? '' : 's'}.
            </>
          )}
          {' '}Present Location stays blank until Phase 3 Audit runs.
        </p>
        <table className="stock-summary">
          <thead><tr>
            <th>Innoviti SKU</th>
            {def.hasVendorSku && <th>Vendor SKU</th>}
            <th>Units</th>
            <th>By state</th>
            <th aria-label="expand" />
          </tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={colCount} style={{ textAlign: 'center', color: '#888' }}>Loading…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={colCount} style={{ textAlign: 'center', color: '#888' }}>No stock rows.</td></tr>
            )}
            {!loading && visible.map((r, i) => {
              const key = groupKey(r);
              const isOpen = !!expanded[key];
              const newSku = i === 0 || visible[i - 1].sku_id !== r.sku_id;
              const det = details[key];
              return (
                <Fragment key={key}>
                  <tr
                    className={`stock-row${newSku ? ' stock-group-start' : ''}`}
                    onClick={() => toggle(r)}
                  >
                    <td>
                      {newSku && (
                        r.sku_number
                          ? <>
                              <strong>{r.sku_number}</strong> <span className="muted">{r.sku_name}</span>
                              {def.hasVendorSku && (
                                <span className="muted"> · {skuTotals.get(r.sku_id)} logical</span>
                              )}
                            </>
                          : <span className="muted">— not linked to an Innoviti SKU</span>
                      )}
                    </td>
                    {def.hasVendorSku && (
                      <td>
                        {r.vendor_sku_number
                          ? <code>{r.vendor_sku_number}</code>
                          : <span className="muted">— no vendor SKU</span>}
                      </td>
                    )}
                    <td><strong>{r.total}</strong></td>
                    <td><StateBreakdown byState={r.by_state} /></td>
                    <td className="stock-caret">{isOpen ? '▾' : '▸'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="stock-detail-row">
                      <td colSpan={colCount}>
                        {det === 'loading'
                          ? <span className="muted">Loading units…</span>
                          : (!det || det.length === 0)
                            ? <span className="muted">No units.</span>
                            : <UnitTable def={def} rows={det} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UnitTable({ def, rows }) {
  return (
    <table className="stock-unit-table">
      <thead><tr>
        <th>{def.indexLabel}</th>
        {def.hasOwner && <th>Owner</th>}
        <th>State</th>
        <th>Present Location</th>
        {def.hasDate && <th>Date of Purchase</th>}
        <th>Loaded</th>
      </tr></thead>
      <tbody>
        {rows.map((u) => (
          <tr key={u.master_id}>
            <td><code>{u.index_value}</code></td>
            {def.hasOwner && <td>{u.owner_vendor_name || '—'}</td>}
            <td><span className="badge plain sm">{u.state}</span></td>
            <td>{u.present_location_name || <span className="muted">— not audited</span>}</td>
            {def.hasDate && <td>{fmtDate(u.date_of_purchase)}</td>}
            <td>{fmtDate(u.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
