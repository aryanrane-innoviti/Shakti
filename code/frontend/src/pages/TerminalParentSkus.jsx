import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal, { ConfirmModal } from '../components/Modal.jsx';

export default function TerminalParentSkus() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [del, setDel] = useState(null);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => api.get('/terminal-parent-skus').then(setRows);
  useEffect(() => { load(); }, []);

  const startNew = () => { setErrors({}); setEdit({ name: '', description: '' }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      if (edit.parent_sku_id) {
        await api.patch(`/terminal-parent-skus/${edit.parent_sku_id}`, { name: edit.name, description: edit.description });
      } else {
        await api.post('/terminal-parent-skus', { name: edit.name, description: edit.description });
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
    const t = del;
    setDel(null);
    try { await api.del(`/terminal-parent-skus/${t.parent_sku_id}`); load(); toast.push('Deleted', 'success'); }
    catch (e) { toast.push(`Delete failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <h2>Terminal Parent SKUs</h2>
        <button className="primary" onClick={startNew}>+ Add</button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr>
            <th>PNN</th><th>Name</th><th>Description</th>
            <th title="Number of Payment Terminal SKUs referencing this Parent SKU. Delete is blocked while this is > 0.">Used by</th>
            <th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.parent_sku_id}>
                <td>{r.parent_sku_number}</td>
                <td>{r.name}</td>
                <td>{r.description || '—'}</td>
                <td>
                  {r.used_by_count > 0
                    ? <span title="Delete blocked — referenced by Payment Terminal SKUs">{r.used_by_count}</span>
                    : <span className="muted">0</span>}
                </td>
                <td>
                  <button onClick={() => setEdit(r)}>Modify</button>{' '}
                  <button onClick={() => setDel(r)} disabled={r.used_by_count > 0}
                          title={r.used_by_count > 0 ? `In use by ${r.used_by_count} SKU(s)` : ''}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={edit.parent_sku_id ? `Modify ${edit.parent_sku_number}` : 'Add Terminal Parent SKU'}
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
            <div className="full"><label>Description</label><textarea rows={3} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          </div>
        </Modal>
      )}
      {del && <ConfirmModal title="Delete Parent SKU?" message={`Hard delete ${del.name}. Will fail if any SKU references it.`} onClose={() => setDel(null)} onConfirm={doDelete} danger confirmLabel="Delete" />}
    </>
  );
}
