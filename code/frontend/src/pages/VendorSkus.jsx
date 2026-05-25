import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

/**
 * Manage Vendor SKU — the vendor SKU catalogue.
 *
 * A vendor SKU is a first-class entity: a vendor's product with its own
 * number, name, pricing and spec PDF. It can supply many Innoviti SKUs; those
 * links are created and managed from each Innoviti SKU's detail page.
 */
export default function VendorSkus() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [skuTypes, setSkuTypes] = useState([]);
  const [filter, setFilter] = useState({ vendor_id: '', sku_type_id: '' });
  const [showDeleted, setShowDeleted] = useState(false);
  const [edit, setEdit] = useState(null);
  const [editMode, setEditMode] = useState('add');
  const pdfRefs = useRef({});

  const load = () => {
    const parts = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    if (showDeleted) parts.push('include_deleted=1');
    const q = parts.join('&');
    api.get('/vendor-skus' + (q ? '?' + q : '')).then(setRows);
  };
  useEffect(() => { load(); }, [filter, showDeleted]);
  useEffect(() => {
    api.get('/vendors').then(setVendors);
    api.get('/sku-types').then(setSkuTypes);
  }, []);

  const save = async () => {
    try {
      if (editMode === 'add') {
        if (!edit.vendor_id) { toast.push('Pick a vendor', 'error'); return; }
        if (!edit.sku_type_id) { toast.push('Pick a SKU Type', 'error'); return; }
        await api.post('/vendor-skus', {
          vendor_id: edit.vendor_id,
          sku_type_id: edit.sku_type_id,
          vendor_sku_number: edit.vendor_sku_number,
          vendor_sku_name: edit.vendor_sku_name,
          vendor_sku_price_moq: edit.vendor_sku_price_moq,
          vendor_sku_price_unit: edit.vendor_sku_price_unit,
        });
        toast.push('Vendor SKU added', 'success');
      } else {
        await api.patch(`/vendor-skus/${edit.vendor_sku_id}`, {
          vendor_sku_number: edit.vendor_sku_number,
          vendor_sku_name: edit.vendor_sku_name,
          vendor_sku_price_moq: edit.vendor_sku_price_moq,
          vendor_sku_price_unit: edit.vendor_sku_price_unit,
        });
        toast.push('Vendor SKU updated', 'success');
      }
      setEdit(null);
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const remove = async (r) => {
    if (!confirm(`Delete vendor SKU "${r.vendor_sku_number}"?`)) return;
    try {
      await api.del(`/vendor-skus/${r.vendor_sku_id}`);
      toast.push('Vendor SKU deleted', 'success');
      load();
    } catch (e) {
      toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error');
    }
  };

  const toggleStatus = async (r) => {
    const next = r.status === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Mark vendor SKU "${r.vendor_sku_number}" as ${next}?`)) return;
    try {
      await api.post(`/vendor-skus/${r.vendor_sku_id}/status`);
      toast.push(`Vendor SKU marked ${next}`, 'success');
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const restore = async (r) => {
    try {
      await api.post(`/vendor-skus/${r.vendor_sku_id}/restore`);
      toast.push('Vendor SKU restored', 'success');
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const uploadPdf = async (r, file) => {
    if (!file) return;
    try {
      await api.upload(`/vendor-skus/${r.vendor_sku_id}/specification`, file);
      load();
      toast.push('Spec PDF uploaded', 'success');
    } catch (e) { toast.push(`Upload failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const viewPdf = async (r) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const token = localStorage.getItem('shakti_token');
      const res = await fetch(`${base}/vendor-skus/${r.vendor_sku_id}/specification`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Could not load PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast.push(e.message || 'View failed', 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <h2>Manage Vendor SKU</h2>
        <button
          className="primary"
          onClick={() => {
            setEditMode('add');
            setEdit({ vendor_id: '', sku_type_id: '', vendor_sku_number: '', vendor_sku_name: '', vendor_sku_price_moq: '', vendor_sku_price_unit: '' });
          }}
        >+ Add Vendor SKU</button>
      </div>

      <div className="filter-bar">
        <select value={filter.vendor_id} onChange={(e) => setFilter({ ...filter, vendor_id: e.target.value })}>
          <option value="">Any vendor</option>
          {vendors.map((v) => (
            <option key={v.vendor_id} value={v.vendor_id}>
              {v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}
            </option>
          ))}
        </select>
        <select value={filter.sku_type_id} onChange={(e) => setFilter({ ...filter, sku_type_id: e.target.value })}>
          <option value="">Any SKU Type</option>
          {skuTypes.map((t) => <option key={t.sku_type_id} value={t.sku_type_id}>{t.name}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </div>

      <div className="card table-wrap">
        <p className="help-text" style={{ marginTop: 0 }}>
          Each row is one vendor SKU — a vendor's product with its own number, name, price and spec.
          The Innoviti SKU ↔ Vendor SKU mapping is captured at Innoviti SKU creation only and is
          not editable from this screen.
        </p>
        <table className="card-table" style={{ tableLayout: 'fixed', minWidth: 1000 }}>
          <colgroup>
            <col style={{ width: '15%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead><tr>
            <th>Vendor</th><th>SKU Type</th><th>Vendor SKU Number</th><th>Vendor SKU Name</th><th>MOQ</th><th>Unit price</th>
            <th>Status</th><th>Spec PDF</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#888' }}>No vendor SKUs yet.</td></tr>
            )}
            {rows.map((r) => {
              const deleted = !!r.deleted_at;
              return (
              <tr key={r.vendor_sku_id} style={deleted ? { opacity: 0.55 } : undefined}>
                <td data-label="Vendor">
                  {r.vendor_name}
                  {r.vendor_status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                  {deleted && <span className="badge inactive" style={{ marginLeft: 6 }}>Deleted</span>}
                </td>
                <td data-label="SKU Type">{r.sku_type_name || <span className="muted">—</span>}</td>
                <td data-label="Vendor SKU Number"><code>{r.vendor_sku_number}</code></td>
                <td data-label="Vendor SKU Name">{r.vendor_sku_name || '—'}</td>
                <td data-label="MOQ">{r.vendor_sku_price_moq ?? '—'}</td>
                <td data-label="Unit price">{r.vendor_sku_price_unit ?? '—'}</td>
                <td data-label="Status">
                  <span className={`badge ${r.status === 'Active' ? 'active' : 'inactive'} sm`}>{r.status}</span>
                </td>
                <td data-label="Spec PDF" className="actions-cell">
                  {deleted ? (
                    <span className="muted">
                      {r.vendor_sku_specification_pdf
                        ? String(r.vendor_sku_specification_pdf).split(/[\\/]/).pop()
                        : '—'}
                    </span>
                  ) : (
                    <div className="row-actions">
                      {r.vendor_sku_specification_pdf && (
                        <button type="button" onClick={() => viewPdf(r)}>View</button>
                      )}
                      <input
                        ref={(el) => { pdfRefs.current[r.vendor_sku_id] = el; }}
                        type="file"
                        accept="application/pdf"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0];
                          if (f) { uploadPdf(r, f); e.target.value = ''; }
                        }}
                      />
                      <button type="button" onClick={() => pdfRefs.current[r.vendor_sku_id]?.click()}>
                        {r.vendor_sku_specification_pdf ? 'Replace' : 'Upload'}
                      </button>
                    </div>
                  )}
                </td>
                <td data-label="Actions" className="actions-cell">
                  {deleted ? (
                    <div className="row-actions">
                      <button onClick={() => restore(r)}>Restore</button>
                    </div>
                  ) : (
                    <div className="row-actions">
                      <button onClick={() => { setEditMode('edit'); setEdit({ ...r }); }}>Modify</button>
                      <button onClick={() => toggleStatus(r)}>
                        {r.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => remove(r)}>Delete</button>
                    </div>
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
          title={editMode === 'add' ? 'Add Vendor SKU' : `Modify ${edit.vendor_sku_number}`}
          onClose={() => setEdit(null)}
          actions={<>
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save}>{editMode === 'add' ? 'Add' : 'Save'}</button>
          </>}
        >
          <div className="form-grid">
            <div>
              <label>Vendor *</label>
              {editMode === 'add' ? (
                <select value={edit.vendor_id || ''} onChange={(e) => setEdit({ ...edit, vendor_id: Number(e.target.value) })}>
                  <option value="">Pick…</option>
                  {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.company_name}{v.status === 'Inactive' ? ' (Inactive)' : ''}</option>)}
                </select>
              ) : (
                <input value={edit.vendor_name || ''} disabled />
              )}
            </div>
            <div>
              <label>SKU Type *{editMode === 'edit' ? ' (immutable)' : ''}</label>
              {editMode === 'add' ? (
                <select value={edit.sku_type_id || ''} onChange={(e) => setEdit({ ...edit, sku_type_id: Number(e.target.value) })}>
                  <option value="">Pick…</option>
                  {skuTypes.map((t) => <option key={t.sku_type_id} value={t.sku_type_id}>{t.name}</option>)}
                </select>
              ) : (
                <input value={edit.sku_type_name || '—'} disabled />
              )}
            </div>
            <div><label>Vendor SKU Number *</label><input value={edit.vendor_sku_number || ''} onChange={(e) => setEdit({ ...edit, vendor_sku_number: e.target.value })} /></div>
            <div><label>Vendor SKU Name</label><input value={edit.vendor_sku_name || ''} onChange={(e) => setEdit({ ...edit, vendor_sku_name: e.target.value })} placeholder="optional" /></div>
            <div>
              <label>MOQ</label>
              <input
                type="number" min="1" step="1"
                value={edit.vendor_sku_price_moq || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && Number(v) < 1) return;
                  setEdit({ ...edit, vendor_sku_price_moq: v });
                }}
                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                placeholder="≥ 1"
              />
            </div>
            <div>
              <label>Unit price</label>
              <input
                type="number" min="0" step="0.01"
                value={edit.vendor_sku_price_unit || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && Number(v) < 0) return;
                  setEdit({ ...edit, vendor_sku_price_unit: v });
                }}
                onKeyDown={(e) => { if (e.key === '-') e.preventDefault(); }}
                placeholder="≥ 0"
              />
            </div>
            <div className="full help-text">
              A vendor SKU number must be unique within its vendor. After saving, link this vendor
              SKU to the Innoviti SKUs it supplies from each Innoviti SKU's detail page.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
