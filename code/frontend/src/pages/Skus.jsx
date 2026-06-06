import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY = {
  sku_name: '', description: '', stm: '', sku_type_id: '',
  approx_price_moq: '', approx_price_unit: '',
  vendor_sku_ids: [],
};

export default function Skus() {
  const toast = useToast();
  const [skus, setSkus] = useState([]);           // filtered list — drives the table
  const [types, setTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorSkus, setVendorSkus] = useState([]);
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [filter, setFilter] = useState({ sku_type_id: '', status: '', vendor_id: '' });

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const loadFiltered = () => {
    const parts = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    const q = parts.join('&');
    // The list response now carries vendor_count per row (see backend
    // routes/skus.js GET /). No per-row fetch needed.
    api.get('/skus' + (q ? '?' + q : '')).then(setSkus);
  };
  const loadVendorSkus = () => api.get('/vendor-skus').then(setVendorSkus);
  useEffect(() => { loadFiltered(); }, [filter]);
  useEffect(() => {
    loadVendorSkus();
    api.get('/sku-types').then(setTypes);
    api.get('/vendors').then(setVendors);
  }, []);

  // Refresh the vendor-SKU picker when the modal opens so freshly created
  // vendor SKUs show up.
  useEffect(() => {
    if (edit) loadVendorSkus();
  }, [edit?.sku_id, edit?.sku_type_id]);

  const selectedType = types.find((t) => t.sku_type_id === Number(edit?.sku_type_id));
  const requiresSerial = !!selectedType?.serial_eligible;

  // When the user picks (or switches to) a serial-eligible type, force STM=Serial.
  // When they pick a non-serial-eligible type, force STM=None. Also drop any
  // vendor SKU picks since they belong to the previous SKU Type.
  useEffect(() => {
    if (!edit || !selectedType) return;
    const desired = selectedType.serial_eligible ? 'Serial' : 'None';
    const isCreate = !edit.sku_id;
    // SKU Type is immutable on Modify, so the only case where prior vendor_sku_ids
    // belong to a different type is during Create when the user re-picks the type.
    if (edit.stm !== desired) {
      setEdit((prev) => ({ ...prev, stm: desired, ...(isCreate ? { vendor_sku_ids: [] } : {}) }));
    } else if (isCreate && edit.vendor_sku_ids && edit.vendor_sku_ids.length) {
      setEdit((prev) => ({ ...prev, vendor_sku_ids: [] }));
    }
  }, [selectedType?.sku_type_id]);
  // Vendor SKUs of the same SKU Type — offered as a multi-select on create.
  const categoryVendorSkus = useMemo(
    () => (selectedType ? vendorSkus.filter((vs) => vs.sku_type_id === selectedType.sku_type_id) : []),
    [vendorSkus, selectedType]
  );

  const toggleStatus = async (s) => {
    const next = s.status === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Mark ${s.sku_name} as ${next}?`)) return;
    try {
      await api.post(`/skus/${s.sku_id}/status`);
      toast.push(`${s.sku_name} marked ${next}`, 'success');
      loadFiltered();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Status change failed', 'error');
    }
  };

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      ['sku_id','sku_number','created_at','updated_at','deleted_at','sku_type_name','serial_eligible','status','specifications_pdf','vendor_count'].forEach(k => delete payload[k]);
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });
      if (edit.sku_id) await api.patch(`/skus/${edit.sku_id}`, payload);
      else await api.post('/skus', payload);
      setEdit(null);
      loadFiltered();
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
        <h2>Manage Innoviti SKUs</h2>
        <button className="primary" onClick={startNew}>+ Add Innoviti SKU</button>
      </div>
      <div className="filter-bar">
        <select value={filter.sku_type_id} onChange={(e) => setFilter({ ...filter, sku_type_id: e.target.value })}>
          <option value="">Any type</option>
          {types.map((t) => <option key={t.sku_type_id} value={t.sku_type_id}>{t.name}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Any status</option><option>Active</option><option>Inactive</option>
        </select>
        <select value={filter.vendor_id} onChange={(e) => setFilter({ ...filter, vendor_id: e.target.value })}>
          <option value="">Any vendor</option>
          {vendors.map((v) => (
            <option key={v.vendor_id} value={v.vendor_id}>
              {v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-wrap">
        <table className="card-table">
          <thead><tr><th>INN</th><th>Name</th><th>SKU Type</th><th>Tracking</th><th>Vendor count</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {skus.map((s) => {
              const vendorCount = Number.isFinite(s.vendor_count) ? s.vendor_count : 0;
              return (
                <tr key={s.sku_id}>
                  <td data-label="INN">{s.sku_number}</td>
                  <td data-label="Name">
                    <Link to={`/skus/${s.sku_id}`}>{s.sku_name}</Link>
                  </td>
                  <td data-label="SKU Type">{s.sku_type_name}</td>
                  <td data-label="Tracking">{s.stm === 'Serial' ? 'Serial #' : 'Untracked'}</td>
                  <td data-label="Vendor count">
                    {vendorCount}
                    {vendorCount === 0 && <span style={{ color: '#a15c00', marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td data-label="Status"><span className={`badge ${s.status === 'Active' ? 'active' : 'inactive'}`}>{s.status}</span></td>
                  <td data-label="Actions" className="actions-cell">
                    <div className="row-actions">
                      <button onClick={() => setEdit(s)}>Modify</button>
                      <button onClick={() => toggleStatus(s)}>
                        {s.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={edit.sku_id ? `Modify ${edit.sku_number}` : 'Add Innoviti SKU'}
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
            <div className={`full ${fieldClass('sku_name')}`}>
              <label>SKU name *</label>
              <input value={edit.sku_name || ''} onChange={(e) => setEdit({ ...edit, sku_name: e.target.value })} />
              {fieldError('sku_name') && <div className="error-text">{fieldError('sku_name')}</div>}
            </div>
            <div className="full"><label>Description</label><textarea rows={2} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className={fieldClass('sku_type_id')}>
              <label>SKU Type *{edit.sku_id ? ' (immutable)' : ''}</label>
              <select disabled={!!edit.sku_id} value={edit.sku_type_id || ''} onChange={(e) => setEdit({ ...edit, sku_type_id: Number(e.target.value) })}>
                <option value="">Pick…</option>
                {types.map((t) => <option key={t.sku_type_id} value={t.sku_type_id}>{t.name}{t.serial_eligible ? ' (serial)' : ''}</option>)}
              </select>
              {fieldError('sku_type_id') && <div className="error-text">{fieldError('sku_type_id')}</div>}
            </div>
            <div className={fieldClass('stm')}>
              <label>STM *</label>
              <select
                value={edit.stm}
                disabled={!!selectedType}
                onChange={(e) => setEdit({ ...edit, stm: e.target.value })}
              >
                {requiresSerial
                  ? <option value="Serial">Serial</option>
                  : <option value="None">None</option>}
              </select>
              <div className="help-text">
                {!selectedType && 'Pick a SKU type — STM is set by the type.'}
                {selectedType && requiresSerial &&
                  `"${selectedType.name}" is tracked by Serial number. "None" is not allowed.`}
                {selectedType && !requiresSerial &&
                  `"${selectedType.name}" is not serial-eligible. STM is fixed to None.`}
              </div>
              {fieldError('stm') && <div className="error-text">{fieldError('stm')}</div>}
            </div>
            <div className={fieldClass('approx_price_moq')}>
              <label>Price MOQ</label>
              <input
                type="number"
                min="1"
                step="1"
                value={edit.approx_price_moq || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && Number(v) < 1) return;
                  setEdit({ ...edit, approx_price_moq: v });
                }}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                placeholder="≥ 1"
              />
              {fieldError('approx_price_moq') && <div className="error-text">{fieldError('approx_price_moq')}</div>}
            </div>
            <div className={fieldClass('approx_price_unit')}>
              <label>Unit price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={edit.approx_price_unit || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && Number(v) < 0) return;
                  setEdit({ ...edit, approx_price_unit: v });
                }}
                onKeyDown={(e) => { if (e.key === '-') e.preventDefault(); }}
                placeholder="≥ 0"
              />
              {fieldError('approx_price_unit') && <div className="error-text">{fieldError('approx_price_unit')}</div>}
            </div>

            {selectedType && (
              <div className={`full ${fieldClass('vendor_sku_ids')}`}>
                <label>Vendor SKUs <span className="muted" style={{ fontSize: 11 }}>· optional · same SKU Type · editable after creation</span></label>
                {categoryVendorSkus.length === 0 ? (
                  <div className="help-text">
                    No vendor SKUs of type "{selectedType.name}" yet — you can create them later on the
                    <b> Vendor SKUs</b> screen. The Innoviti SKU can still be saved without one.
                  </div>
                ) : (
                  <div className="check-list">
                    {categoryVendorSkus.map((vs) => {
                      const checked = (edit.vendor_sku_ids || []).includes(vs.vendor_sku_id);
                      return (
                        <label key={vs.vendor_sku_id} className={`check-item${checked ? ' checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = new Set(edit.vendor_sku_ids || []);
                              if (e.target.checked) cur.add(vs.vendor_sku_id); else cur.delete(vs.vendor_sku_id);
                              setEdit({ ...edit, vendor_sku_ids: Array.from(cur) });
                            }}
                          />
                          <span>{vs.vendor_sku_number}{vs.vendor_sku_name ? ` — ${vs.vendor_sku_name}` : ''}</span>
                          <span className="muted mono-id" style={{ marginLeft: 'auto' }}>{vs.vendor_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {fieldError('vendor_sku_ids') && <div className="error-text">{fieldError('vendor_sku_ids')}</div>}
                <div className="help-text">
                  Optional. {edit.sku_id
                    ? 'Tick or untick to change which Vendor SKUs supply this Innoviti SKU. The default supplier is preserved when still ticked; otherwise the first remaining link becomes the default.'
                    : 'The first vendor SKU ticked becomes the default supplier. You can revise this set later by Modifying the Innoviti SKU.'}
                </div>
              </div>
            )}

            <div className="full help-text">
              Vendor SKU numbers, pricing, and vendor spec PDFs are managed on the
              <b> Vendor SKUs</b> screen.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
