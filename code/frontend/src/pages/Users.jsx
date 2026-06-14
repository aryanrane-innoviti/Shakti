import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';
import PincodeField from '../components/PincodeField.jsx';

const EMPTY = {
  first_name: '', last_name: '', user_type_id: '',
  email: '', password: '',
  mobile: '', vendor_id: '', employee_id: '',
  address_line_1: '', address_line_2: '', pincode: '', city: '', state: '',
  location_id: '',
};

export default function Users() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);
  const [resetUrl, setResetUrl] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const isSA = currentUser?.user_type_code === 'SA';
  const canModifyTarget = (u) => isSA || u.user_type_code !== 'SA';

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => {
    const q = showDeleted ? '?include_deleted=1' : '';
    api.get('/users' + q).then(setUsers);
    api.get('/users/dashboard/summary').then((r) => setTotal(r.total));
  };
  useEffect(() => {
    load();
  }, [showDeleted]);
  useEffect(() => {
    api.get('/user-types').then(setTypes);
    api.get('/vendors').then(setVendors);
    api.get('/locations').then(setLocations);
  }, []);

  const innoviti = vendors.find((v) => v.is_seed || v.company_name === 'Innoviti');
  const isInnovitiUser = edit ? Number(edit.vendor_id) === innoviti?.vendor_id : false;
  const editingExisting = !!(edit && edit.user_id);
  // ASO users carry no address (task1.md §3) — hide the whole Address section.
  const selectedType = types.find((t) => Number(t.user_type_id) === Number(edit?.user_type_id));
  const selectedTypeCode = selectedType?.code || edit?.user_type_code;
  // Location picker shows only for location-eligible types, scoped to the
  // user's own vendor (task1.md §3).
  const locationEligible = !!selectedType?.location_eligible;
  const vendorLocations = locations.filter(
    (l) => Number(l.vendor_id) === Number(edit?.vendor_id) && !l.deleted_at
  );

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY, vendor_id: innoviti?.vendor_id ?? '' }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });
      // Location: send explicitly so clearing works (null), but only for
      // location-eligible types (the API ignores it for other types).
      if (locationEligible) {
        payload.location_id = edit.location_id === '' || edit.location_id == null ? null : Number(edit.location_id);
      } else {
        delete payload.location_id;
      }
      if (editingExisting) {
        await api.patch(`/users/${edit.user_id}`, payload);
        toast.push('User updated', 'success');
      } else {
        await api.post('/users', payload);
        toast.push('User created', 'success');
      }
      setEdit(null);
      load();
    } catch (e) {
      const raw = e.data || {};
      let fieldMap = {};
      if (raw.fields && !Array.isArray(raw.fields) && typeof raw.fields === 'object') {
        fieldMap = raw.fields;
      } else if (Array.isArray(raw.fields)) {
        // Legacy shape: ['mobile', 'email'] — flag them with the top-level message
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
    const target = confirmDel;
    setConfirmDel(null);
    try {
      await api.del(`/users/${target.user_id}`);
      toast.push('User marked inactive', 'success');
      load();
    } catch {
      toast.push('Delete failed', 'error');
    }
  };

  const copyReset = async (u) => {
    const r = await api.post(`/users/${u.user_id}/password-reset-url`);
    const url = `${window.location.origin}/reset?token=${r.token}`;
    setResetUrl(url);
    try { await navigator.clipboard.writeText(url); } catch {}
  };

  const doRestore = async (u) => {
    try {
      await api.post(`/users/${u.user_id}/restore`);
      toast.push(`Restored ${u.first_name} ${u.last_name} — still Inactive; toggle status to activate.`, 'success');
      load();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Restore failed', 'error');
    }
  };

  const toggleStatus = async (u) => {
    try {
      const r = await api.post(`/users/${u.user_id}/status`);
      toast.push(`User is now ${r.status}`, 'success');
      if (r.password_reset_token) {
        setResetUrl(`${window.location.origin}/reset?token=${r.password_reset_token}`);
      }
      load();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Toggle failed', 'error');
    }
  };

  const onVendorChange = (vid) => {
    const nextInnoviti = Number(vid) === innoviti?.vendor_id;
    // Changing vendor invalidates a previously-picked location (it belonged to
    // the old vendor) — clear it so the picker re-scopes to the new vendor.
    setEdit((p) => ({ ...p, vendor_id: vid, employee_id: nextInnoviti ? p.employee_id : '', location_id: '' }));
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Operations · Section 1.1</span>
          <h1>Users</h1>
          <div className="kpi">
            <span className="num">{total}</span>
            <span className="label">Total users on file</span>
          </div>
        </div>
        <div className="actions">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Show deleted
          </label>
          <button className="primary" onClick={startNew}>+ Add user</button>
        </div>
      </div>

      <div className="card table-wrap">
        {users.length === 0 ? (
          <div className="empty">
            <h4>No users yet.</h4>
            <p>Add an Innoviti employee or a vendor-associated user to begin.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>UIN</th>
                <th>Name</th>
                <th>User Type</th>
                <th>Email</th>
                <th>Vendor</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const deleted = !!u.deleted_at;
                const protectedRow = !canModifyTarget(u);
                return (
                  <tr key={u.user_id} style={deleted ? { opacity: 0.55 } : undefined}>
                    <td>{u.user_index}</td>
                    <td>
                      {u.first_name} {u.last_name}
                      {deleted && <span className="badge inactive" style={{ marginLeft: 6 }}>Deleted</span>}
                    </td>
                    <td><span className="badge plain">{u.user_type_code}</span></td>
                    <td className="mono-id">{u.email}</td>
                    <td>
                      {u.vendor_id ? <Link to={`/vendors/${u.vendor_id}`}>{u.vendor_name}</Link> : (u.vendor_name || '—')}
                      {u.vendor_status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                    </td>
                    <td><span className={`badge ${u.status === 'Active' ? 'active' : 'inactive'}`}>{u.status}</span></td>
                    <td>
                      {protectedRow ? (
                        <span className="muted" style={{ fontSize: 12 }} title="Only the Super Admin can modify the SA account">
                          SA — protected
                        </span>
                      ) : deleted ? (
                        <button onClick={() => doRestore(u)}>Restore</button>
                      ) : (
                        <div className="row-actions">
                          <button onClick={() => setEdit(u)}>Modify</button>
                          <button onClick={() => toggleStatus(u)}>
                            {u.status === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={() => setConfirmDel(u)}>Delete</button>
                          <button onClick={() => copyReset(u)}>Reset URL</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal
          title={editingExisting ? `Modify ${edit.user_index}` : 'Add user'}
          onClose={closeEdit}
          actions={
            <>
              <button onClick={closeEdit}>Cancel</button>
              <button className="primary" onClick={save}>Save</button>
            </>
          }
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
            <h3>Identity</h3>
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
              <input type="email" name="new-user-email" autoComplete="off" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="you@innoviti.com" />
              {fieldError('email') && <div className="error-text">{fieldError('email')}</div>}
            </div>
            {!editingExisting && (
              <div className="full">
                <label>Initial password</label>
                <input type="password" name="new-user-password" autoComplete="new-password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="Share once — user will reset on first login" />
              </div>
            )}

            <h3>Role &amp; vendor</h3>
            <div className={fieldClass('user_type_id')}>
              <label>User type *</label>
              <select disabled={editingExisting} value={edit.user_type_id || ''} onChange={(e) => setEdit({ ...edit, user_type_id: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {types.filter((t) => t.code !== 'SA').map((t) => (
                  <option key={t.user_type_id} value={t.user_type_id}>{t.label}</option>
                ))}
              </select>
              {fieldError('user_type_id') && <div className="error-text">{fieldError('user_type_id')}</div>}
            </div>
            <div className={fieldClass('vendor_id')}>
              <label>Vendor *</label>
              <select value={edit.vendor_id || ''} onChange={(e) => onVendorChange(Number(e.target.value))}>
                <option value="">Pick…</option>
                {vendors.map((v) => (
                  <option key={v.vendor_id} value={v.vendor_id}>
                    {v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}
                  </option>
                ))}
              </select>
              {fieldError('vendor_id') && <div className="error-text">{fieldError('vendor_id')}</div>}
            </div>
            <div className={fieldClass('mobile')}>
              <label>Mobile</label>
              <input value={edit.mobile || ''} placeholder="optional · 10 digits, starts 6–9" onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} />
              {fieldError('mobile') && <div className="error-text">{fieldError('mobile')}</div>}
            </div>
            {isInnovitiUser && (
              <div className={fieldClass('employee_id')}>
                <label>Employee ID *</label>
                <input placeholder="IC/0001 or INN/9999" value={edit.employee_id || ''} onChange={(e) => setEdit({ ...edit, employee_id: e.target.value })} />
                {fieldError('employee_id') && <div className="error-text">{fieldError('employee_id')}</div>}
              </div>
            )}

            {selectedTypeCode !== 'ASO' && (
              <>
                <h3>Address</h3>
                <div className="full"><label>Address line 1</label><input value={edit.address_line_1 || ''} onChange={(e) => setEdit({ ...edit, address_line_1: e.target.value })} /></div>
                <div className="full"><label>Address line 2</label><input value={edit.address_line_2 || ''} onChange={(e) => setEdit({ ...edit, address_line_2: e.target.value })} /></div>
                <PincodeField
                  pincode={edit.pincode}
                  city={edit.city}
                  state={edit.state}
                  onChange={(p) => setEdit({ ...edit, ...p })}
                />
                {fieldError('pincode') && <div className="full"><div className="error-text">{fieldError('pincode')}</div></div>}
              </>
            )}

            {locationEligible && (
              <>
                <h3>Location</h3>
                <div className={`full ${fieldClass('location_id')}`}>
                  <label>Assigned Location</label>
                  <select
                    value={edit.location_id ?? ''}
                    onChange={(e) => setEdit({ ...edit, location_id: e.target.value })}
                    disabled={!edit.vendor_id}
                  >
                    <option value="">— None —</option>
                    {vendorLocations.map((l) => (
                      <option key={l.location_id} value={l.location_id}>
                        {l.location_name} ({l.location_index})
                      </option>
                    ))}
                  </select>
                  <div className="help-text">
                    {edit.vendor_id
                      ? "Lists this user's vendor's locations. The vendor must match."
                      : 'Pick a vendor first.'}
                  </div>
                  {fieldError('location_id') && <div className="error-text">{fieldError('location_id')}</div>}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmModal
          title="Mark user inactive?"
          message={`This will soft-delete ${confirmDel.first_name} ${confirmDel.last_name}. Historical references remain.`}
          onClose={() => setConfirmDel(null)}
          onConfirm={doDelete}
          confirmLabel="Mark inactive"
          danger
        />
      )}

      {resetUrl && (
        <Modal
          title="Password reset URL"
          onClose={() => setResetUrl(null)}
          actions={<button className="primary" onClick={() => setResetUrl(null)}>Done</button>}
        >
          <p>Copy this single-use, 24-hour URL and share it with the user.</p>
          <input value={resetUrl} readOnly onFocus={(e) => e.target.select()} className="mono" />
        </Modal>
      )}
    </>
  );
}
