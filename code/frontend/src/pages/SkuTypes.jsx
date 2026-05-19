import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

export default function SkuTypes() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => api.get('/sku-types').then(setRows);
  useEffect(() => { load(); }, []);

  const startNew = () => { setErrors({}); setEdit({ name: '', serial_eligible: false }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      if (edit.sku_type_id) {
        await api.patch(`/sku-types/${edit.sku_type_id}`, { name: edit.name });
      } else {
        await api.post('/sku-types', { name: edit.name, serial_eligible: !!edit.serial_eligible });
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

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Catalog · Section 7</span>
          <h1>SKU Types</h1>
          <p className="meta">
            Whether items of this type may be tracked by serial number is fixed at creation
            and not editable. SKU types are <strong>not deletable</strong> — once created they
            stay on file forever to preserve historical references.
          </p>
        </div>
        <div className="actions">
          <button className="primary" onClick={startNew}>+ Add SKU type</button>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr>
            <th>Name</th>
            <th title="When Yes, SKUs of this type must use Serial-number tracking (STM=Serial). Fixed at creation, never editable.">Serial-eligible</th>
            <th title="Seed = shipped with the system, cannot be renamed. Custom = added later. SKU types are never deletable.">Origin</th>
            <th></th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.sku_type_id}>
                <td>{t.name}</td>
                <td>
                  {t.serial_eligible
                    ? <span className="badge purple">Yes</span>
                    : <span className="badge plain">No</span>}
                </td>
                <td>{t.is_seed ? <span className="badge plain">Seed</span> : <span className="badge purple">Custom</span>}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={() => setEdit(t)}>Rename</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={edit.sku_type_id ? `Rename ${edit.name}` : 'Add SKU type'}
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
              <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              {fieldError('name') && <div className="error-text">{fieldError('name')}</div>}
            </div>
            {!edit.sku_type_id && (
              <div>
                <label>Serial-eligible</label>
                <label style={{ display: 'flex', alignItems: 'center', textTransform: 'none', letterSpacing: 'normal', fontSize: 14, fontWeight: 300, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={!!edit.serial_eligible} onChange={(e) => setEdit({ ...edit, serial_eligible: e.target.checked })} />
                  Items of this type carry a serial number
                </label>
                <div className="help-text">Immutable after creation. SKU types cannot be deleted, so choose carefully.</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
