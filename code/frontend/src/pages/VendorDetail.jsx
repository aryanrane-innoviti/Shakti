import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function VendorDetail() {
  const { id } = useParams();
  const [vendor, setVendor] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [skus, setSkus] = useState([]);
  const [supplierRows, setSupplierRows] = useState([]);

  useEffect(() => {
    api.get(`/vendors/${id}`).then(setVendor);
    api.get(`/vendors/${id}/contacts`).then(setContacts);
    api.get(`/users?vendor_id=${id}`).then(setUsers);
    api.get(`/locations?vendor_id=${id}`).then(setLocations);
    api.get(`/skus?vendor_id=${id}`).then(setSkus);
    api.get(`/skus/-/vendor-assocs?vendor_id=${id}`).then(setSupplierRows);
  }, [id]);

  if (!vendor) return <div>Loading…</div>;

  const isInactive = vendor.status === 'Inactive';

  return (
    <>
      <div className="page-header">
        <h2>
          {vendor.company_name}
          {' '}<span className="badge">{vendor.vendor_type_name}</span>
          {isInactive && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
        </h2>
      </div>
      <div className="card">
        <p><b>Index:</b> {vendor.vendor_index}</p>
        <p><b>GST:</b> {vendor.gst_number || '—'}</p>
        <p><b>Status:</b> <span className={`badge ${vendor.status === 'Active' ? 'active' : 'inactive'}`}>{vendor.status}</span></p>
      </div>

      <div className="card">
        <h3>Contact Persons ({contacts.length})</h3>
        {contacts.length === 0 ? <p>No contacts.</p> : (
          <ul>
            {contacts.map((c) => <li key={c.contact_id}>{c.first_name} {c.last_name}{c.deleted_at ? ' (deleted)' : ''} — {c.email}</li>)}
          </ul>
        )}
        <Link to="/contacts">Manage contacts →</Link>
      </div>

      <div className="card">
        <h3>Users associated ({users.length})</h3>
        {users.length === 0 ? <p>No users.</p> : users.map((u) => (
          <div key={u.user_id}>{u.user_index} — {u.first_name} {u.last_name} ({u.user_type_label})</div>
        ))}
      </div>

      <div className="card">
        <h3>Locations ({locations.length})</h3>
        {locations.length === 0 ? <p>No locations.</p> : locations.map((l) => (
          <div key={l.location_id}>{l.location_index} — {l.location_name}</div>
        ))}
      </div>

      <div className="card">
        <h3>SKUs supplied ({skus.length})</h3>
        {skus.length === 0 ? (
          <p>This vendor doesn't supply any SKUs yet.</p>
        ) : (
          <table>
            <thead><tr><th>INN</th><th>SKU Name</th><th>SKU Type</th><th>Vendor SKU #</th><th>Unit price</th></tr></thead>
            <tbody>
              {skus.map((s) => {
                const rows = supplierRows.filter((r) => r.sku_id === s.sku_id);
                if (rows.length === 0) {
                  return (
                    <tr key={s.sku_id}>
                      <td><Link to={`/skus/${s.sku_id}`}>{s.sku_number}</Link></td>
                      <td>{s.sku_name}</td>
                      <td>{s.sku_type_name}</td>
                      <td colSpan={2} className="muted">supplier row missing detail</td>
                    </tr>
                  );
                }
                return rows.map((r, i) => (
                  <tr key={r.sku_vendor_assoc_id}>
                    <td>{i === 0 ? <Link to={`/skus/${s.sku_id}`}>{s.sku_number}</Link> : ''}</td>
                    <td>{i === 0 ? s.sku_name : ''}</td>
                    <td>{i === 0 ? s.sku_type_name : ''}</td>
                    <td><code>{r.vendor_sku_number}</code></td>
                    <td>{r.vendor_sku_price_unit ?? '—'}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
        <Link to="/vendor-skus">Manage Vendor SKUs →</Link>
      </div>
    </>
  );
}
