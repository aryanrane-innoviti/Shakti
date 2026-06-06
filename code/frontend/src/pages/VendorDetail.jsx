import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function VendorDetail() {
  const { id } = useParams();
  const [vendor, setVendor] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [vendorSkus, setVendorSkus] = useState([]);

  useEffect(() => {
    api.get(`/vendors/${id}`).then(setVendor);
    api.get(`/vendors/${id}/contacts`).then(setContacts);
    api.get(`/users?vendor_id=${id}`).then(setUsers);
    api.get(`/locations?vendor_id=${id}`).then(setLocations);
    api.get(`/vendor-skus?vendor_id=${id}`).then(setVendorSkus);
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
        <h3>Vendor SKUs ({vendorSkus.length})</h3>
        {vendorSkus.length === 0 ? (
          <p>This vendor has no vendor SKUs yet.</p>
        ) : (
          <div className="table-wrap">
          <table>
            <thead><tr><th>Vendor SKU Number</th><th>Vendor SKU Name</th><th>Unit price</th><th>Status</th><th>Adapters / Cables</th><th>Supplies Innoviti SKUs</th></tr></thead>
            <tbody>
              {vendorSkus.map((vs) => {
                const linked = Array.isArray(vs.linked_skus) ? vs.linked_skus : [];
                const adaptors = Array.isArray(vs.adaptors) ? vs.adaptors : [];
                const usbCables = Array.isArray(vs.usb_cables) ? vs.usb_cables : [];
                return (
                  <tr key={vs.vendor_sku_id}>
                    <td><code>{vs.vendor_sku_number}</code></td>
                    <td>{vs.vendor_sku_name || '—'}</td>
                    <td>{vs.vendor_sku_price_unit ?? '—'}</td>
                    <td><span className={`badge ${vs.status === 'Active' ? 'active' : 'inactive'} sm`}>{vs.status}</span></td>
                    <td>
                      {adaptors.length === 0 && usbCables.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div style={{ fontSize: 12 }}>
                          {adaptors.length > 0 && <div>Adapters: {adaptors.map((a) => a.vendor_sku_number).join(', ')}</div>}
                          {usbCables.length > 0 && <div>Cables: {usbCables.map((u) => u.vendor_sku_number).join(', ')}</div>}
                        </div>
                      )}
                    </td>
                    <td>
                      {linked.length === 0 ? (
                        <span className="muted">none</span>
                      ) : (
                        <span className="stock-states">
                          {linked.map((s) => (
                            <Link key={s.sku_id} to={`/skus/${s.sku_id}`} title={s.sku_name}>
                              {s.sku_number}{s.is_default ? ' ★' : ''}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <Link to="/vendor-skus">Manage Vendor SKUs →</Link>
      </div>
    </>
  );
}
