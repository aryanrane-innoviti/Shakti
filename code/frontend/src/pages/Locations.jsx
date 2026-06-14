import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';
import PincodeField from '../components/PincodeField.jsx';

const EMPTY = {
  vendor_id: '', location_name: '',
  address_line_1: '', address_line_2: '', pincode: '', city: '', state: '',
};

export default function Locations() {
  const toast = useToast();
  const { user } = useAuth();
  const isSA = user?.user_type_code === 'SA';

  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const startEdit = (l) => { setErrors({}); setEdit({ ...l }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const load = () => api.get('/locations' + (filter ? `?vendor_id=${filter}` : '')).then(setLocations);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { api.get('/vendors').then(setVendors); }, []);

  const editing = !!(edit && edit.location_id);

  // A Location carries only vendor + name + address. Contacts and Users attach
  // to it from their own forms (task1.md §1.12, §9); the panels below are
  // read-only derived projections.
  const save = async () => {
    setErrors({});
    try {
      const payload = {
        vendor_id: edit.vendor_id,
        location_name: edit.location_name,
        address_line_1: edit.address_line_1,
        address_line_2: edit.address_line_2,
        pincode: edit.pincode,
        city: edit.city,
        state: edit.state,
      };
      Object.keys(payload).forEach((k) => { if (payload[k] === '' || payload[k] === null) delete payload[k]; });

      if (editing) await api.patch(`/locations/${edit.location_id}`, payload);
      else await api.post('/locations', payload);

      setEdit(null);
      load();
      toast.push('Saved', 'success');
    } catch (e) {
      const raw = e.data || {};
      let fieldMap = {};
      if (raw.fields && !Array.isArray(raw.fields) && typeof raw.fields === 'object') {
        fieldMap = raw.fields;
      } else if (Array.isArray(raw.fields)) {
        for (const f of raw.fields) fieldMap[f] = raw.error || 'invalid';
      }
      setErrors(fieldMap);
      const summary = Object.keys(fieldMap).length
        ? `Check: ${Object.keys(fieldMap).join(', ')}`
        : (raw.error || e.message || 'Save failed');
      toast.push(summary, 'error');
    }
  };

  const doDelete = async () => {
    const t = confirmDel;
    setConfirmDel(null);
    try { await api.del(`/locations/${t.location_id}`); load(); toast.push('Deleted', 'success'); }
    catch (e) { toast.push(e?.data?.error || 'Delete failed', 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <h2>Manage Locations</h2>
        <button className="primary" onClick={startNew}>+ Add Location</button>
      </div>
      <div className="filter-bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v.vendor_id} value={v.vendor_id}>
              {v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>LIN</th><th>Vendor</th><th>Name</th><th>City</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.location_id}>
                <td>{l.location_index}</td>
                <td>{l.vendor_name}</td>
                <td>{l.location_name}</td>
                <td>{l.city || '—'}</td>
                <td>
                  <button onClick={() => startEdit(l)}>Modify</button>{' '}
                  <button onClick={() => setConfirmDel(l)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={editing ? `Modify ${edit.location_index}` : 'Add Location'}
          onClose={closeEdit}
          actions={<><button onClick={closeEdit}>Cancel</button><button className="primary" onClick={save}>Save</button></>}
        >
          {Object.keys(errors).length > 0 && (
            <div className="error-banner">
              <strong>Please correct the highlighted field{Object.keys(errors).length === 1 ? '' : 's'}:</strong>
              <ul>
                {Object.entries(errors).map(([k, v]) => (
                  <li key={k}><code>{k}</code> — {String(v)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-grid">
            <div className={fieldClass('vendor_id')}>
              <label>Vendor *</label>
              <select disabled={editing && !isSA} value={edit.vendor_id || ''} onChange={(e) => setEdit({ ...edit, vendor_id: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}</option>)}
              </select>
              {editing && !isSA && <div className="help-text">Only SA can change vendor.</div>}
              {fieldError('vendor_id') && <div className="error-text">{fieldError('vendor_id')}</div>}
            </div>
            <div className={fieldClass('location_name')}>
              <label>Location Name *</label>
              <input value={edit.location_name || ''} onChange={(e) => setEdit({ ...edit, location_name: e.target.value })} />
              {fieldError('location_name') && <div className="error-text">{fieldError('location_name')}</div>}
            </div>
            <div className="full"><label>Address Line 1</label><input value={edit.address_line_1 || ''} onChange={(e) => setEdit({ ...edit, address_line_1: e.target.value })} /></div>
            <div className="full"><label>Address Line 2</label><input value={edit.address_line_2 || ''} onChange={(e) => setEdit({ ...edit, address_line_2: e.target.value })} /></div>
            <PincodeField pincode={edit.pincode} city={edit.city} state={edit.state} onChange={(p) => setEdit({ ...edit, ...p })} />
            {fieldError('pincode') && <div className="full"><div className="error-text">{fieldError('pincode')}</div></div>}

            {editing && (
              <div className="full" style={{ borderTop: '1px solid var(--border, #e5e7eb)', marginTop: 8, paddingTop: 12 }}>
                <LocationChildrenPanel locationId={edit.location_id} />
              </div>
            )}
          </div>
        </Modal>
      )}
      {confirmDel && (
        <ConfirmModal title="Delete location?" message={`Soft-delete ${confirmDel.location_name}. Re-point any assigned users first.`} onClose={() => setConfirmDel(null)} onConfirm={doDelete} danger confirmLabel="Delete" />
      )}
    </>
  );
}

// Read-only derived view of a Location's children (task1.md §9): the Users whose
// location_id points here, and the Contacts whose location_id points here. The
// association lives on the child — change it from the User / Contact form.
function LocationChildrenPanel({ locationId }) {
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!locationId) return;
    api.get(`/locations/${locationId}`)
      .then(setData)
      .catch((e) => toast.push(e?.data?.error || e.message || 'Failed to load location detail', 'error'));
  }, [locationId]);

  const users = data?.assigned_users || [];
  const contacts = data?.contacts || [];

  return (
    <>
      <label>Assigned Users ({users.length})</label>
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {users.length === 0 && <span className="meta">No users point here. Assign from the User form.</span>}
        {users.map((u) => (
          <span key={u.user_id} className="pill active" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {u.first_name} {u.last_name}
            {u.user_type_code ? <span style={{ opacity: 0.7 }}>· {u.user_type_code}</span> : null}
          </span>
        ))}
      </div>

      <label>Contacts at this location ({contacts.length})</label>
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
        {contacts.length === 0 && <span className="meta">No contacts point here. Attach from the Contact form.</span>}
        {contacts.map((c) => (
          <span key={c.contact_id} className="pill" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {c.first_name} {c.last_name}{c.deleted ? ' (deleted)' : ''}
          </span>
        ))}
      </div>
      <div className="help-text">Read-only — these associations are set on the User / Contact forms.</div>
    </>
  );
}
