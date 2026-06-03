import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';
import PincodeField from '../components/PincodeField.jsx';

const EMPTY = {
  vendor_id: '', location_name: '', owner_type: 'Contact',
  address_line_1: '', address_line_2: '', pincode: '', city: '', state: '',
  principal_contact_id: '', secondary_contact_id: '',
};

const ADMIN_TYPES = ['SA', 'ADMIN'];

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
  const startEdit = (l) => { setErrors({}); setEdit({ ...l }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const load = () => api.get('/locations' + (filter ? `?vendor_id=${filter}` : '')).then(setLocations);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    api.get('/vendors').then(setVendors);
    api.get('/contacts').then(setContacts);
  }, []);

  const editing = !!(edit && edit.location_id);
  const ownerType = edit?.owner_type || 'Contact';
  const vendorContacts = useMemo(
    () => contacts.filter((c) => !c.deleted_at && Number(c.vendor_id) === Number(edit?.vendor_id)),
    [contacts, edit?.vendor_id]
  );
  const isInnovitiVendor = useMemo(() => {
    const v = vendors.find((x) => Number(x.vendor_id) === Number(edit?.vendor_id));
    return v?.company_name === 'Innoviti';
  }, [vendors, edit?.vendor_id]);

  // The Contact/ASO toggle controls ONLY the location's contact info (ASO-owned
  // locations carry no contact). Assigned users (users.location_id) are an
  // independent concern handled by the panel below, so switching owner type
  // never touches them.
  const setOwnerType = (t) => {
    if (t === 'ASO') setEdit({ ...edit, owner_type: 'ASO', principal_contact_id: '', secondary_contact_id: '' });
    else setEdit({ ...edit, owner_type: 'Contact' });
  };
  const onPickVendor = (e) => {
    const vid = Number(e.target.value);
    const v = vendors.find((x) => Number(x.vendor_id) === vid);
    const next = { ...edit, vendor_id: vid };
    // ASO ownership is Innoviti-only; leaving Innoviti reverts to Contact mode.
    if (v?.company_name !== 'Innoviti' && edit.owner_type === 'ASO') next.owner_type = 'Contact';
    // Eligible assignees are vendor-scoped, so a vendor change invalidates the
    // current selection.
    next._assigned_ids = [];
    setEdit(next);
  };

  const save = async () => {
    setErrors({});
    try {
      const mode = edit.owner_type || 'Contact';
      const payload = { ...edit };
      ['location_id','location_index','created_at','updated_at','deleted_at','vendor_name','pc_first','pc_last','pc_deleted','pc_vendor_id','sc_first','sc_last','sc_deleted','sc_vendor_id','principal_contact_display','secondary_contact_display','_assigned_ids'].forEach(k => delete payload[k]);
      if (mode === 'ASO') { delete payload.principal_contact_id; delete payload.secondary_contact_id; }
      Object.keys(payload).forEach((k) => { if (payload[k] === '' || payload[k] === null) delete payload[k]; });

      let locId = edit.location_id;
      if (editing) await api.patch(`/locations/${edit.location_id}`, payload);
      else { const created = await api.post('/locations', payload); locId = created.location_id; }

      // Apply the user assignment once the location exists. An undefined
      // _assigned_ids means the panel never loaded, so leave assignment alone.
      if (Array.isArray(edit._assigned_ids)) {
        await api.put(`/locations/${locId}/assigned-users`, { user_ids: edit._assigned_ids });
      }

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

  const noContactsForVendor = edit && edit.vendor_id && vendorContacts.length === 0;
  const saveDisabled = ownerType === 'Contact' && noContactsForVendor;

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
                <td>{l.owner_type === 'ASO' ? <span className="meta">ASO-owned</span> : l.principal_contact_display}</td>
                <td>{l.owner_type === 'ASO' ? '—' : (l.secondary_contact_display || '—')}</td>
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
          actions={<><button onClick={closeEdit}>Cancel</button><button className="primary" onClick={save} disabled={saveDisabled}>Save</button></>}
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
              <select disabled={editing && !isSA} value={edit.vendor_id || ''} onChange={onPickVendor}>
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

            <div className={`full ${fieldClass('owner_type')}`}>
              <label>This address belongs to *</label>
              <div className="row-actions" style={{ gap: 20 }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 'normal' }}>
                  <input type="radio" name="owner_type" checked={ownerType === 'Contact'} onChange={() => setOwnerType('Contact')} /> Contact
                </label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 'normal', opacity: isInnovitiVendor ? 1 : 0.5 }}>
                  <input type="radio" name="owner_type" checked={ownerType === 'ASO'} disabled={!isInnovitiVendor} onChange={() => setOwnerType('ASO')} /> ASO
                </label>
              </div>
              {!isInnovitiVendor && <div className="help-text">ASO ownership is available only for the Innoviti vendor.</div>}
              {fieldError('owner_type') && <div className="error-text">{fieldError('owner_type')}</div>}
            </div>

            {ownerType === 'Contact' && (
              <>
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
              </>
            )}

            <div className="full" style={{ borderTop: '1px solid var(--border, #e5e7eb)', marginTop: 8, paddingTop: 12 }}>
              <AssignedUsersPanel
                location={edit}
                ids={edit._assigned_ids}
                onChange={(v) => setEdit((cur) => ({ ...cur, _assigned_ids: v }))}
              />
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

// Assign users whose home/audit location is this location. users.location_id is
// the single source of truth; the write rides PUT /locations/:id/assigned-users
// from the parent's save(). This is a *draft* editor — it lifts the chosen ids
// up via onChange and never mutates directly, so create and edit behave
// identically and the assignment applies atomically on Save. Only active,
// non-admin users of the location's own vendor are eligible.
function AssignedUsersPanel({ location, ids, onChange }) {
  const toast = useToast();
  const [allUsers, setAllUsers] = useState([]);
  const [roster, setRoster] = useState({}); // user_id -> user (for display labels)
  const [loading, setLoading] = useState(true);
  const seeded = useRef(false);

  const vendorId = Number(location?.vendor_id) || null;
  const selected = ids || [];

  useEffect(() => {
    api.get('/users')
      .then((us) => {
        const assignable = (us || []).filter((u) => !ADMIN_TYPES.includes(u.user_type_code) && u.status === 'Active' && !u.deleted_at);
        setAllUsers(assignable);
        setRoster((r) => { const n = { ...r }; assignable.forEach((u) => { n[u.user_id] = u; }); return n; });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Seed once: an existing location loads its current assignment; a brand-new
  // (or vendor-reset) one starts empty.
  const seed = useCallback(() => {
    if (seeded.current || ids !== undefined) return;
    seeded.current = true;
    if (location?.location_id) {
      api.get(`/locations/${location.location_id}`)
        .then((loc) => {
          const assigned = loc.assigned_users || [];
          setRoster((r) => { const n = { ...r }; assigned.forEach((u) => { n[u.user_id] = u; }); return n; });
          onChange(assigned.map((u) => u.user_id));
        })
        .catch((e) => toast.push(e?.data?.error || e.message || 'Failed to load assigned users', 'error'));
    } else {
      onChange([]);
    }
  }, [ids, location, onChange, toast]);
  useEffect(() => { seed(); }, [seed]);

  if (!vendorId) {
    return (
      <div>
        <label>Assigned Users</label>
        <p className="meta">Select a vendor first.</p>
      </div>
    );
  }

  const selectedSet = new Set(selected);
  const eligible = allUsers.filter((u) => Number(u.vendor_id) === vendorId);
  const available = eligible.filter((u) => !selectedSet.has(u.user_id));

  return (
    <div>
      <label>Assigned Users</label>
      <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {selected.length === 0 && <span className="meta">No users assigned yet.</span>}
        {selected.map((uid) => {
          const u = roster[uid];
          return (
            <span key={uid} className="pill active" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {u ? `${u.first_name} ${u.last_name}` : `User ${uid}`}
              {u?.user_type_code ? <span style={{ opacity: 0.7 }}>· {u.user_type_code}</span> : null}
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== uid))}
                aria-label={`Remove ${u ? `${u.first_name} ${u.last_name}` : uid}`}
                style={{ padding: '0 6px', lineHeight: 1 }}
              >×</button>
            </span>
          );
        })}
      </div>
      <select
        value=""
        disabled={loading}
        onChange={(e) => {
          const idv = Number(e.target.value);
          e.target.value = '';
          if (idv && !selectedSet.has(idv)) onChange([...selected, idv]);
        }}
      >
        <option value="">{loading ? 'Loading…' : (available.length ? '+ Add a user…' : 'No eligible users for this vendor')}</option>
        {available.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.first_name} {u.last_name} · {u.user_type_code} · {u.user_index}
          </option>
        ))}
      </select>
      <div className="help-text">
        Only active, non-admin users of this location's vendor can be assigned. Applied on Save; blocked if a user has an in-flight audit.
      </div>
    </div>
  );
}
