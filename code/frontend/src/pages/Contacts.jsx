import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';

const EMPTY = { first_name: '', last_name: '', email: '', mobile: '', vendor_id: '', location_id: '' };

export default function Contacts() {
  const toast = useToast();
  const [contacts, setContacts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => api.get('/contacts' + (filter ? `?vendor_id=${filter}` : '')).then(setContacts);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    api.get('/vendors').then(setVendors);
    api.get('/locations').then(setLocations);
  }, []);

  const editing = !!(edit && edit.contact_id);
  // A Contact's optional Location must belong to the Contact's vendor (task1.md §4).
  const vendorLocations = locations.filter(
    (l) => Number(l.vendor_id) === Number(edit?.vendor_id) && !l.deleted_at
  );

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });
      // Send location_id explicitly so clearing it works (null = no location).
      payload.location_id = edit.location_id === '' || edit.location_id == null ? null : Number(edit.location_id);
      if (editing) await api.patch(`/contacts/${edit.contact_id}`, payload);
      else await api.post('/contacts', payload);
      setEdit(null);
      toast.push('Saved', 'success');
      load();
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
    try { await api.del(`/contacts/${t.contact_id}`); toast.push('Deleted', 'success'); load(); }
    catch { toast.push('Delete failed', 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <h2>Manage Contacts</h2>
        <button className="primary" onClick={startNew}>+ Add Contact</button>
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
          <thead>
            <tr><th>NIN</th><th>Name</th><th>Email</th><th>Mobile</th><th>Vendor</th><th>Location</th><th></th></tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.contact_id}>
                <td>{c.contact_index}</td>
                <td>{c.first_name} {c.last_name}{c.deleted_at ? ' (deleted)' : ''}</td>
                <td>{c.email}</td>
                <td>{c.mobile || '—'}</td>
                <td>
                  {c.vendor_id ? <Link to={`/vendors/${c.vendor_id}`}>{c.vendor_name}</Link> : c.vendor_name}
                  {c.vendor_status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                </td>
                <td>{c.location_name || '—'}</td>
                <td>
                  {!c.deleted_at && <>
                    <button onClick={() => setEdit(c)}>Modify</button>{' '}
                    <button onClick={() => setConfirmDel(c)}>Delete</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={editing ? `Modify ${edit.contact_index}` : 'Add Contact'}
          onClose={closeEdit}
          actions={<><button onClick={closeEdit}>Cancel</button><button className="primary" onClick={save}>Save</button></>}
        >
          {Object.keys(errors).length > 0 && (
            <div className="error-banner">
              <strong>Please correct the highlighted field{Object.keys(errors).length === 1 ? '' : 's'}:</strong>
              <ul>
                {Object.entries(errors).map(([k, v]) => (
                  <li key={k}><code>{k}</code> — {v}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-grid">
            <div className={fieldClass('vendor_id')}>
              <label>Vendor *</label>
              <select value={edit.vendor_id || ''} onChange={(e) => setEdit({ ...edit, vendor_id: Number(e.target.value), location_id: '' })}>
                <option value="">Pick…</option>
                {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}</option>)}
              </select>
              {fieldError('vendor_id') && <div className="error-text">{fieldError('vendor_id')}</div>}
            </div>
            <div className={fieldClass('location_id')}>
              <label>Location</label>
              <select value={edit.location_id ?? ''} onChange={(e) => setEdit({ ...edit, location_id: e.target.value })} disabled={!edit.vendor_id}>
                <option value="">— None —</option>
                {vendorLocations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>{l.location_name} ({l.location_index})</option>
                ))}
              </select>
              <div className="help-text">{edit.vendor_id ? "Optional · this vendor's locations only." : 'Pick a vendor first.'}</div>
              {fieldError('location_id') && <div className="error-text">{fieldError('location_id')}</div>}
            </div>
            <div className={fieldClass('first_name')}>
              <label>First name *</label>
              <input value={edit.first_name || ''} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} />
              {fieldError('first_name') && <div className="error-text">{fieldError('first_name')}</div>}
            </div>
            <div className={fieldClass('last_name')}>
              <label>Last name *</label>
              <input value={edit.last_name || ''} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} />
              {fieldError('last_name') && <div className="error-text">{fieldError('last_name')}</div>}
            </div>
            <div className={`full ${fieldClass('email')}`}>
              <label>Email *</label>
              <input value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              {fieldError('email') && <div className="error-text">{fieldError('email')}</div>}
            </div>
            <div className={fieldClass('mobile')}>
              <label>Mobile</label>
              <input value={edit.mobile || ''} placeholder="optional" onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} />
              {fieldError('mobile') && <div className="error-text">{fieldError('mobile')}</div>}
            </div>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <ConfirmModal title="Delete contact?" message={`Soft-delete ${confirmDel.first_name} ${confirmDel.last_name}.`} onClose={() => setConfirmDel(null)} onConfirm={doDelete} danger confirmLabel="Delete" />
      )}
    </>
  );
}
