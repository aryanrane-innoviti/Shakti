import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';

export default function VendorTypes() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [del, setDel] = useState(null);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => api.get('/vendor-types').then(setRows);
  useEffect(() => { load(); }, []);

  const startNew = () => { setErrors({}); setEdit({ name: '' }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      await api.post('/vendor-types', { name: edit.name });
      setEdit(null);
      load();
      toast.push('Vendor type added', 'success');
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
    const t = del;
    setDel(null);
    try { await api.del(`/vendor-types/${t.vendor_type_id}`); load(); toast.push('Deleted', 'success'); }
    catch (e) { toast.push(`Failed: ${e.data?.error || e.message}`, 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Catalog · Section 5</span>
          <h1>Vendor Types</h1>
          <p className="meta">
            The taxonomy under which every vendor is filed. Names are immutable after creation;
            delete is allowed only when no vendor still references the type.
          </p>
        </div>
        <div className="actions">
          <button className="primary" onClick={startNew}>+ Add vendor type</button>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th title="Seed = shipped with the system, cannot be renamed or deleted. Custom = added later; deletable only when no vendor uses it.">Origin</th><th></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.vendor_type_id}>
                <td>{t.name}</td>
                <td>{t.is_seed ? <span className="badge plain">Seed</span> : <span className="badge purple">Custom</span>}</td>
                <td>
                  <div className="row-actions">
                    <button className="danger" onClick={() => setDel(t)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title="Add vendor type"
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
            <div className={`full ${fieldClass('name')}`}>
              <label>Name *</label>
              <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Calibration Vendors" />
              <div className="help-text">1–50 characters, case-insensitive unique. Cannot be renamed later.</div>
              {fieldError('name') && <div className="error-text">{fieldError('name')}</div>}
            </div>
          </div>
        </Modal>
      )}

      {del && (
        <ConfirmModal
          title="Delete vendor type?"
          message={`Hard-delete “${del.name}”. Fails if any vendor still references it.`}
          confirmLabel="Delete"
          danger
          onClose={() => setDel(null)}
          onConfirm={doDelete}
        />
      )}
    </>
  );
}
