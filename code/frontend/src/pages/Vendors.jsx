import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';
import PincodeField from '../components/PincodeField.jsx';

const EMPTY = {
  company_name: '', vendor_type_id: '', gst_number: '',
  reg_line_1: '', reg_line_2: '', reg_pincode: '', reg_city: '', reg_state: '',
  op_line_1: '', op_line_2: '', op_pincode: '', op_city: '', op_state: '',
};

export default function Vendors() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [types, setTypes] = useState([]);
  const [statusF, setStatusF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});

  const isSA = currentUser?.user_type_code === 'SA';
  const canModifyTarget = (v) => isSA || !v.is_seed;

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => {
    const q = [];
    if (statusF) q.push(`status=${statusF}`);
    if (typeF) q.push(`vendor_type_id=${typeF}`);
    if (showDeleted) q.push('include_deleted=1');
    api.get('/vendors' + (q.length ? '?' + q.join('&') : '')).then(setVendors);
  };
  useEffect(() => { load(); }, [statusF, typeF, showDeleted]);
  useEffect(() => { api.get('/vendor-types').then(setTypes); }, []);

  const editing = !!(edit && edit.vendor_id);
  const innovitiSelected = editing && edit.is_seed === 1;

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      ['is_seed','vendor_id','vendor_index','status','created_at','updated_at','deleted_at','vendor_type_name'].forEach(k => delete payload[k]);
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });
      if (editing) await api.patch(`/vendors/${edit.vendor_id}`, payload);
      else await api.post('/vendors', payload);
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

  const toggle = async (v) => {
    try { await api.post(`/vendors/${v.vendor_id}/status`); load(); }
    catch { toast.push('Toggle failed', 'error'); }
  };

  const doRestore = async (v) => {
    try {
      await api.post(`/vendors/${v.vendor_id}/restore`);
      toast.push(`Restored ${v.company_name} — still Inactive; toggle status to activate.`, 'success');
      load();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Restore failed', 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Manage Vendors</h2>
        <button className="primary" onClick={startNew}>+ Add Vendor</button>
      </div>
      <div className="filter-bar">
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">Any status</option><option>Active</option><option>Inactive</option>
        </select>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)}>
          <option value="">Any type</option>
          {types.map((t) => <option key={t.vendor_type_id} value={t.vendor_type_id}>{t.name}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>VEN</th><th>Company</th><th>Vendor Type</th><th>GST</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {vendors.map((v) => {
              const deleted = !!v.deleted_at;
              const protectedRow = !canModifyTarget(v);
              return (
                <tr key={v.vendor_id} style={deleted ? { opacity: 0.55 } : undefined}>
                  <td>{v.vendor_index}</td>
                  <td>
                    <Link to={`/vendors/${v.vendor_id}`}>{v.company_name}</Link>
                    {v.is_seed === 1 && <span className="badge warn" style={{ marginLeft: 6 }}>seed</span>}
                    {deleted && <span className="badge inactive" style={{ marginLeft: 6 }}>Deleted</span>}
                  </td>
                  <td>{v.vendor_type_name}</td>
                  <td>{v.gst_number || '—'}</td>
                  <td><span className={`badge ${v.status === 'Active' ? 'active' : 'inactive'}`}>{v.status}</span></td>
                  <td>
                    {protectedRow ? (
                      <span className="muted" style={{ fontSize: 12 }} title="Only the Super Admin can modify the Innoviti seed vendor">
                        Seed — protected
                      </span>
                    ) : deleted ? (
                      <button onClick={() => doRestore(v)}>Restore</button>
                    ) : (
                      <>
                        <button onClick={() => setEdit(v)}>Modify</button>{' '}
                        <button onClick={() => toggle(v)}>Toggle</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={editing ? `Modify ${edit.vendor_index}` : 'Add Vendor'}
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
            <div className={`full ${fieldClass('company_name')}`}>
              <label>Company name *</label>
              <input value={edit.company_name || ''} onChange={(e) => setEdit({ ...edit, company_name: e.target.value })} />
              {fieldError('company_name') && <div className="error-text">{fieldError('company_name')}</div>}
            </div>
            <div className={fieldClass('vendor_type_id')}>
              <label>Vendor type *</label>
              <select value={edit.vendor_type_id || ''} onChange={(e) => setEdit({ ...edit, vendor_type_id: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {types.map((t) => <option key={t.vendor_type_id} value={t.vendor_type_id}>{t.name}</option>)}
              </select>
              {fieldError('vendor_type_id') && <div className="error-text">{fieldError('vendor_type_id')}</div>}
            </div>
            <div className={fieldClass('gst_number')}>
              <label>GSTIN {innovitiSelected ? '(optional for Innoviti)' : '*'}</label>
              <input value={edit.gst_number || ''} onChange={(e) => setEdit({ ...edit, gst_number: e.target.value.toUpperCase() })} placeholder="22AAAAA0000A1Z5" />
              {fieldError('gst_number') && <div className="error-text">{fieldError('gst_number')}</div>}
            </div>
          </div>

          <h3 style={{ marginTop: 20 }}>Registered Office</h3>
          <div className="form-grid">
            <div className="full"><label>Line 1</label><input value={edit.reg_line_1 || ''} onChange={(e) => setEdit({ ...edit, reg_line_1: e.target.value })} /></div>
            <div className="full"><label>Line 2</label><input value={edit.reg_line_2 || ''} onChange={(e) => setEdit({ ...edit, reg_line_2: e.target.value })} /></div>
            <PincodeField
              pincode={edit.reg_pincode}
              city={edit.reg_city}
              state={edit.reg_state}
              onChange={(p) => setEdit({ ...edit, reg_pincode: p.pincode, reg_city: p.city, reg_state: p.state })}
            />
          </div>

          <h3 style={{ marginTop: 20 }}>Operational Address</h3>
          <div className="form-grid">
            <div className="full"><label>Line 1</label><input value={edit.op_line_1 || ''} onChange={(e) => setEdit({ ...edit, op_line_1: e.target.value })} /></div>
            <div className="full"><label>Line 2</label><input value={edit.op_line_2 || ''} onChange={(e) => setEdit({ ...edit, op_line_2: e.target.value })} /></div>
            <PincodeField
              pincode={edit.op_pincode}
              city={edit.op_city}
              state={edit.op_state}
              onChange={(p) => setEdit({ ...edit, op_pincode: p.pincode, op_city: p.city, op_state: p.state })}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
