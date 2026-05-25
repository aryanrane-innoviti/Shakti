import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const OBJECT_TYPES = [
  'User', 'UserType', 'Contact', 'Vendor', 'VendorType',
  'SKU', 'SKUType', 'SKUVendorAssociation', 'Location',
];

export default function ChangeLog() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState({ object_type: '', object_id: '', actor_user_id: '' });

  const load = () => {
    const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api.get('/change-log' + (q ? '?' + q : '')).then(setRows);
  };
  useEffect(() => { load(); }, [filter]);

  return (
    <>
      <div className="page-header"><h2>Global Change Log</h2></div>
      <div className="filter-bar">
        <select value={filter.object_type} onChange={(e) => setFilter({ ...filter, object_type: e.target.value })}>
          <option value="">Any object type</option>
          {OBJECT_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input placeholder="Object id (e.g. VEN-10001)" value={filter.object_id} onChange={(e) => setFilter({ ...filter, object_id: e.target.value })} />
        <input placeholder="Actor user id" value={filter.actor_user_id} onChange={(e) => setFilter({ ...filter, actor_user_id: e.target.value })} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Object</th><th>ID</th><th>Action</th><th>Actor</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.change_log_id}>
                <td>{r.occurred_at}</td>
                <td>{r.object_type}</td>
                <td title={r.object_id}>{r.object_label || r.object_id}</td>
                <td><span className="badge">{r.action}</span></td>
                <td>{r.actor_user_index || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
