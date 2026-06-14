import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

export default function UserTypes() {
  const { user } = useAuth();
  const toast = useToast();
  const isSA = user?.user_type_code === 'SA';

  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const load = () => api.get('/user-types').then(setRows);
  useEffect(() => { load(); }, []);

  const startNew = () => { setErrors({}); setEdit({ code: '', label: '', location_eligible: false }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const save = async () => {
    setErrors({});
    try {
      if (edit.user_type_id) {
        const body = { label: edit.label };
        // location_eligible is fixed for seeded types; only send it for custom ones.
        if (!edit.is_seed) body.location_eligible = !!edit.location_eligible;
        await api.patch(`/user-types/${edit.user_type_id}`, body);
      } else {
        await api.post('/user-types', { code: edit.code, label: edit.label, location_eligible: !!edit.location_eligible });
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
          <span className="eyebrow">Governance · Section 2</span>
          <h1>User Types</h1>
          <p className="meta">
            The codes that gate every other object. Renaming is allowed for operational
            types; SA &amp; Admin are immutable. New types ship at zero permissions until you wire them in.
          </p>
        </div>
        <div className="actions">
          {isSA && <button className="primary" onClick={startNew}>+ Add user type</button>}
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Label</th><th title="Seed = shipped with the system. Custom = added by an SA. Immutable rows cannot be renamed or deleted.">Origin</th><th title="Whether Users of this type attach an Inventory Location on the User form.">Location</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.user_type_id}>
                <td>{t.code}</td>
                <td>{t.label}</td>
                <td>
                  {t.is_seed ? <span className="badge plain">Seed</span> : <span className="badge purple">Custom</span>}
                  {t.is_immutable && <span className="badge system" style={{ marginLeft: 6 }}>Immutable</span>}
                </td>
                <td>{t.location_eligible ? <span className="badge active">Yes</span> : <span className="muted">No</span>}</td>
                <td>
                  <div className="row-actions">
                    {!t.is_immutable && isSA && <button onClick={() => setEdit(t)}>Rename</button>}
                    {t.is_immutable && <span className="muted" style={{ fontSize: 12 }}>System type — label fixed</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={edit.user_type_id ? `Rename ${edit.code}` : 'Add user type'}
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
            {!edit.user_type_id && (
              <div className={fieldClass('code')}>
                <label>Code *</label>
                <input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} placeholder="e.g. ASE" />
                <div className="help-text">Short uppercase identifier, immutable after creation.</div>
                {fieldError('code') && <div className="error-text">{fieldError('code')}</div>}
              </div>
            )}
            <div className={`${edit.user_type_id ? 'full' : ''} ${fieldClass('label')}`}>
              <label>Label *</label>
              <input value={edit.label || ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
              <div className="help-text">ASCII letters, digits, space, hyphen. 1–50 characters.</div>
              {fieldError('label') && <div className="error-text">{fieldError('label')}</div>}
            </div>
            <div className="full">
              <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                <input
                  type="checkbox"
                  checked={!!edit.location_eligible}
                  disabled={!!edit.user_type_id && !!edit.is_seed}
                  onChange={(e) => setEdit({ ...edit, location_eligible: e.target.checked })}
                />
                Location associated?
              </label>
              <div className="help-text">
                {(!!edit.user_type_id && !!edit.is_seed)
                  ? 'Fixed for seeded types.'
                  : 'When on, Users of this type pick an Inventory Location on the User form.'}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
