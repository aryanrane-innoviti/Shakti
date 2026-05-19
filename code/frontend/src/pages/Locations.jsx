import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';
import PincodeField from '../components/PincodeField.jsx';

const EMPTY = {
  vendor_id: '', location_name: '',
  address_line_1: '', address_line_2: '', pincode: '', city: '', state: '',
  principal_contact_id: '', secondary_contact_id: '',
};

export default function Locations() {
  const toast = useToast();
  const { user } = useAuth();
  const isSA = user?.user_type_code === 'SA';

  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const load = () => api.get('/locations' + (filter ? `?vendor_id=${filter}` : '')).then(setLocations);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    api.get('/vendors').then(setVendors);
    api.get('/contacts').then(setContacts);
  }, []);

  const editing = !!(edit && edit.location_id);
  const vendorContacts = useMemo(
    () => contacts.filter((c) => !c.deleted_at && Number(c.vendor_id) === Number(edit?.vendor_id)),
    [contacts, edit?.vendor_id]
  );

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      ['location_id','location_index','created_at','updated_at','deleted_at','vendor_name','pc_first','pc_last','pc_deleted','pc_vendor_id','sc_first','sc_last','sc_deleted','sc_vendor_id','principal_contact_display','secondary_contact_display'].forEach(k => delete payload[k]);
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
    catch { toast.push('Delete failed', 'error'); }
  };

  const noContactsForVendor = edit && edit.vendor_id && vendorContacts.length === 0;

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
          <thead><tr><th>LIN</th><th>Vendor</th><th>Name</th><th>Principal</th><th>Secondary</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.location_id}>
                <td>{l.location_index}</td>
                <td>{l.vendor_name}</td>
                <td>{l.location_name}</td>
                <td>{l.principal_contact_display}</td>
                <td>{l.secondary_contact_display || '—'}</td>
                <td>
                  <button onClick={() => setEdit(l)}>Modify</button>{' '}
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
          actions={<><button onClick={closeEdit}>Cancel</button><button className="primary" onClick={save} disabled={noContactsForVendor}>Save</button></>}
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
            <div className={fieldClass('principal_contact_id')}>
              <label>Principal Contact *</label>
              <select value={edit.principal_contact_id || ''} onChange={(e) => setEdit({ ...edit, principal_contact_id: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {vendorContacts.map((c) => <option key={c.contact_id} value={c.contact_id}>{c.first_name} {c.last_name}</option>)}
              </select>
              {noContactsForVendor && <div className="error-text">No contacts exist for this Vendor — add a contact first.</div>}
              {fieldError('principal_contact_id') && <div className="error-text">{fieldError('principal_contact_id')}</div>}
            </div>
            <div className={fieldClass('secondary_contact_id')}>
              <label>Secondary Contact</label>
              <select value={edit.secondary_contact_id || ''} onChange={(e) => setEdit({ ...edit, secondary_contact_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">—</option>
                {vendorContacts.filter((c) => c.contact_id !== Number(edit.principal_contact_id)).map((c) => <option key={c.contact_id} value={c.contact_id}>{c.first_name} {c.last_name}</option>)}
              </select>
              {fieldError('secondary_contact_id') && <div className="error-text">{fieldError('secondary_contact_id')}</div>}
            </div>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <ConfirmModal title="Delete location?" message={`Soft-delete ${confirmDel.location_name}.`} onClose={() => setConfirmDel(null)} onConfirm={doDelete} danger confirmLabel="Delete" />
      )}
    </>
  );
}
