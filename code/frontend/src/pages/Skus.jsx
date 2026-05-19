import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY = {
  sku_name: '', description: '', stm: '', sku_type_id: '',
  approx_price_moq: '', approx_price_unit: '',
  adaptor_sku_ids: [], usb_cable_sku_ids: [], parent_sku_id: '',
};

export default function Skus() {
  const toast = useToast();
  const [skus, setSkus] = useState([]);           // filtered list — drives the table
  const [allSkus, setAllSkus] = useState([]);     // unfiltered — drives the modal pickers
  const [types, setTypes] = useState([]);
  const [parents, setParents] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [supplierCounts, setSupplierCounts] = useState({}); // sku_id → count
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [filter, setFilter] = useState({ sku_type_id: '', status: '', vendor_id: '' });
  const [showDeleted, setShowDeleted] = useState(false);

  const fieldError = (name) => errors[name] || null;
  const fieldClass = (name) => (errors[name] ? 'has-error' : '');

  const startNew = () => { setErrors({}); setEdit({ ...EMPTY }); };
  const closeEdit = () => { setErrors({}); setEdit(null); };

  const loadFiltered = () => {
    const parts = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    if (showDeleted) parts.push('include_deleted=1');
    const q = parts.join('&');
    api.get('/skus' + (q ? '?' + q : '')).then(async (rows) => {
      setSkus(rows);
      const counts = {};
      await Promise.all(rows.map(async (s) => {
        try {
          const v = await api.get(`/skus/${s.sku_id}/vendors`);
          counts[s.sku_id] = v.length;
        } catch { counts[s.sku_id] = 0; }
      }));
      setSupplierCounts(counts);
    });
  };
  const loadAll = () => api.get('/skus').then(setAllSkus);
  useEffect(() => { loadFiltered(); }, [filter, showDeleted]);
  useEffect(() => {
    loadAll();
    api.get('/sku-types').then(setTypes);
    api.get('/terminal-parent-skus').then(setParents);
    api.get('/vendors').then(setVendors);
  }, []);

  // Refresh allSkus and parents when the modal opens so freshly created prerequisites show up
  useEffect(() => {
    if (edit) {
      loadAll();
      api.get('/terminal-parent-skus').then(setParents);
    }
  }, [edit?.sku_id, edit?.sku_type_id]);

  const selectedType = types.find((t) => t.sku_type_id === Number(edit?.sku_type_id));
  const isPaymentTerminal = selectedType?.name === 'Payment Terminal';
  const requiresSerial = !!selectedType?.serial_eligible;

  // When the user picks (or switches to) a serial-eligible type, force STM=Serial.
  // When they pick a non-serial-eligible type, force STM=None. Keeps the form coherent.
  useEffect(() => {
    if (!edit || !selectedType) return;
    const desired = selectedType.serial_eligible ? 'Serial' : 'None';
    if (edit.stm !== desired) {
      setEdit((prev) => ({ ...prev, stm: desired }));
    }
  }, [selectedType?.sku_type_id]);
  const adaptorType = types.find((t) => t.name === 'Adaptors');
  const usbType = types.find((t) => t.name === 'USB cables');
  const adaptorSkus = useMemo(() => allSkus.filter((s) => s.sku_type_id === adaptorType?.sku_type_id), [allSkus, adaptorType]);
  const usbSkus     = useMemo(() => allSkus.filter((s) => s.sku_type_id === usbType?.sku_type_id),     [allSkus, usbType]);

  const doRestore = async (s) => {
    try {
      await api.post(`/skus/${s.sku_id}/restore`);
      toast.push(`Restored ${s.sku_name} — still Inactive; toggle status to activate.`, 'success');
      loadFiltered();
      loadAll();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Restore failed', 'error');
    }
  };

  const save = async () => {
    setErrors({});
    try {
      const payload = { ...edit };
      ['sku_id','sku_number','created_at','updated_at','deleted_at','sku_type_name','serial_eligible','status','specifications_pdf'].forEach(k => delete payload[k]);
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });
      if (edit.sku_id) await api.patch(`/skus/${edit.sku_id}`, payload);
      else await api.post('/skus', payload);
      setEdit(null);
      loadFiltered();
      loadAll();
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
        <h2>Manage SKUs</h2>
        <button className="primary" onClick={startNew}>+ Add SKU</button>
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
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>INN</th><th>Name</th><th>SKU Type</th><th>Tracking</th><th>Suppliers</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {skus.map((s) => {
              const deleted = !!s.deleted_at;
              return (
                <tr key={s.sku_id} style={deleted ? { opacity: 0.55 } : undefined}>
                  <td>{s.sku_number}</td>
                  <td>
                    <Link to={`/skus/${s.sku_id}`}>{s.sku_name}</Link>
                    {deleted && <span className="badge inactive" style={{ marginLeft: 6 }}>Deleted</span>}
                  </td>
                  <td>{s.sku_type_name}</td>
                  <td>{s.stm === 'Serial' ? 'Serial #' : 'Untracked'}</td>
                  <td>
                    <Link to={`/skus/${s.sku_id}`}>
                      {supplierCounts[s.sku_id] ?? '…'}
                    </Link>
                    {supplierCounts[s.sku_id] === 0 && <span style={{ color: '#a15c00', marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td><span className={`badge ${s.status === 'Active' ? 'active' : 'inactive'}`}>{s.status}</span></td>
                  <td>{deleted ? <button onClick={() => doRestore(s)}>Restore</button> : <button onClick={() => setEdit(s)}>Modify</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={edit.sku_id ? `Modify ${edit.sku_number}` : 'Add SKU'}
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

            {isPaymentTerminal && <>
              <div className="full">
                <label>Adaptor SKUs * <span className="muted" style={{ fontSize: 11 }}>· tick at least one</span></label>
                {adaptorSkus.length === 0 ? (
                  <div className="error-text">No Adaptor SKUs exist — create at least one first (Add SKU with type "Adaptors").</div>
                ) : (
                  <div className="check-list">
                    {adaptorSkus.map((s) => {
                      const checked = (edit.adaptor_sku_ids || []).includes(s.sku_id);
                      return (
                        <label key={s.sku_id} className={`check-item${checked ? ' checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = new Set(edit.adaptor_sku_ids || []);
                              if (e.target.checked) cur.add(s.sku_id); else cur.delete(s.sku_id);
                              setEdit({ ...edit, adaptor_sku_ids: Array.from(cur) });
                            }}
                          />
                          <span>{s.sku_name}</span>
                          <span className="muted mono-id" style={{ marginLeft: 'auto' }}>{s.sku_number}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="full">
                <label>USB Cable SKUs * <span className="muted" style={{ fontSize: 11 }}>· tick at least one</span></label>
                {usbSkus.length === 0 ? (
                  <div className="error-text">No USB Cable SKUs exist — create at least one first (Add SKU with type "USB cables").</div>
                ) : (
                  <div className="check-list">
                    {usbSkus.map((s) => {
                      const checked = (edit.usb_cable_sku_ids || []).includes(s.sku_id);
                      return (
                        <label key={s.sku_id} className={`check-item${checked ? ' checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = new Set(edit.usb_cable_sku_ids || []);
                              if (e.target.checked) cur.add(s.sku_id); else cur.delete(s.sku_id);
                              setEdit({ ...edit, usb_cable_sku_ids: Array.from(cur) });
                            }}
                          />
                          <span>{s.sku_name}</span>
                          <span className="muted mono-id" style={{ marginLeft: 'auto' }}>{s.sku_number}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="full">
                <label>Terminal Parent SKU *</label>
                <select value={edit.parent_sku_id || ''} onChange={(e) => setEdit({ ...edit, parent_sku_id: Number(e.target.value) })}>
                  <option value="">Pick…</option>
                  {parents.map((p) => <option key={p.parent_sku_id} value={p.parent_sku_id}>{p.name}</option>)}
                </select>
                {parents.length === 0 && <div className="error-text">No Terminal Parent SKUs exist — create one first.</div>}
              </div>
            </>}

            <div className="full help-text">
              Vendors, vendor SKU #s, pricing, and vendor spec PDFs are managed on the
              <b> Vendor SKUs</b> screen (or per-SKU from the SKU detail page).
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
