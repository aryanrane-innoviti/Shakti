import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

/**
 * Manage Vendor SKU (task1.md §8.3 line 509)
 * Lists every (Innoviti SKU × Vendor) association row globally. Each row is a
 * distinct supplier with its own vendor SKU #, MOQ, unit price, and spec PDF.
 * No "primary" concept — all peers.
 */
export default function VendorSkus() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [skus, setSkus] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [filter, setFilter] = useState({ sku_id: '', vendor_id: '' });
  const [edit, setEdit] = useState(null);
  const [editMode, setEditMode] = useState('add');
  const pdfRefs = useRef({});

  const load = () => {
    const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    api.get('/skus/-/vendor-assocs' + (q ? '?' + q : '')).then(setRows);
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    api.get('/skus').then(setSkus);
    api.get('/vendors').then(setVendors);
  }, []);

  const save = async () => {
    try {
      if (editMode === 'add') {
        if (!edit.sku_id) { toast.push('Pick an SKU', 'error'); return; }
        await api.post(`/skus/${edit.sku_id}/vendors`, {
          vendor_id: edit.vendor_id,
          vendor_sku_number: edit.vendor_sku_number,
          vendor_sku_price_moq: edit.vendor_sku_price_moq,
          vendor_sku_price_unit: edit.vendor_sku_price_unit,
        });
        toast.push('Supplier row added', 'success');
      } else {
        await api.patch(`/skus/${edit.sku_id}/vendors/${edit.sku_vendor_assoc_id}`, {
          vendor_sku_number: edit.vendor_sku_number,
          vendor_sku_price_moq: edit.vendor_sku_price_moq,
          vendor_sku_price_unit: edit.vendor_sku_price_unit,
        });
        toast.push('Supplier row updated', 'success');
      }
      setEdit(null);
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const remove = async (r) => {
    if (!confirm(`Remove ${r.vendor_name}'s row for ${r.sku_number}?`)) return;
    await api.del(`/skus/${r.sku_id}/vendors/${r.sku_vendor_assoc_id}`);
    load();
  };

  const uploadPdf = async (r, file) => {
    if (!file) return;
    try {
      await api.upload(`/skus/${r.sku_id}/vendors/${r.sku_vendor_assoc_id}/specification`, file);
      load();
      toast.push('Vendor spec uploaded', 'success');
    } catch (e) { toast.push(`Upload failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const viewPdf = async (r) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const token = localStorage.getItem('shakti_token');
      const res = await fetch(`${base}/skus/${r.sku_id}/vendors/${r.sku_vendor_assoc_id}/specification`, {
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
            setEdit({ sku_id: '', vendor_id: '', vendor_sku_number: '', vendor_sku_price_moq: '', vendor_sku_price_unit: '' });
          }}
        >+ Add supplier row</button>
      </div>

      <div className="filter-bar">
        <select value={filter.sku_id} onChange={(e) => setFilter({ ...filter, sku_id: e.target.value })}>
          <option value="">Any SKU</option>
          {skus.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sku_number} — {s.sku_name}</option>)}
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
        <p className="help-text" style={{ marginTop: 0 }}>
          Each row is a distinct supplier for the SKU. Multiple vendors can supply the same SKU; the
          same vendor may also have multiple rows for one SKU with different vendor SKU numbers.
          No row is marked "primary".
        </p>
        <table>
          <thead><tr>
            <th>Innoviti SKU</th><th>SKU Type</th><th>Vendor</th><th>Vendor SKU #</th>
            <th>MOQ</th><th>Unit price</th><th>Vendor Spec PDF</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#888' }}>No supplier rows yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.sku_vendor_assoc_id}>
                <td>
                  <Link to={`/skus/${r.sku_id}`}>{r.sku_number}</Link>{' '}
                  <span className="muted">{r.sku_name}</span>
                </td>
                <td>{r.sku_type_name}</td>
                <td>
                  {r.vendor_name}
                  {r.vendor_status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                </td>
                <td><code>{r.vendor_sku_number}</code></td>
                <td>{r.vendor_sku_price_moq ?? '—'}</td>
                <td>{r.vendor_sku_price_unit ?? '—'}</td>
                <td>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    title={r.vendor_sku_specification_pdf ? String(r.vendor_sku_specification_pdf).split(/[\\/]/).pop() : ''}
                  >
                    {r.vendor_sku_specification_pdf && (
                      <button type="button" onClick={() => viewPdf(r)}>View</button>
                    )}
                    <input
                      ref={(el) => { pdfRefs.current[r.sku_vendor_assoc_id] = el; }}
                      type="file"
                      accept="application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        if (f) { uploadPdf(r, f); e.target.value = ''; }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => pdfRefs.current[r.sku_vendor_assoc_id]?.click()}
                    >
                      {r.vendor_sku_specification_pdf ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                </td>
                <td>
                  <button onClick={() => { setEditMode('edit'); setEdit({ ...r }); }}>Modify</button>{' '}
                  <button onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          title={editMode === 'add' ? 'Add supplier row' : `Modify ${edit.vendor_name} → ${edit.sku_number}`}
          onClose={() => setEdit(null)}
          actions={<>
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button className="primary" onClick={save}>{editMode === 'add' ? 'Add' : 'Save'}</button>
          </>}
        >
          <div className="form-grid">
            <div>
              <label>Innoviti SKU *</label>
              {editMode === 'add' ? (
                <select value={edit.sku_id || ''} onChange={(e) => setEdit({ ...edit, sku_id: Number(e.target.value) })}>
                  <option value="">Pick…</option>
                  {skus.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sku_number} — {s.sku_name}</option>)}
                </select>
              ) : (
                <input value={`${edit.sku_number} — ${edit.sku_name}`} disabled />
              )}
            </div>
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
            <div><label>Vendor SKU # *</label><input value={edit.vendor_sku_number || ''} onChange={(e) => setEdit({ ...edit, vendor_sku_number: e.target.value })} /></div>
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
              The unique key is (SKU, vendor, vendor SKU #). The same vendor may add multiple rows
              for one SKU as long as the vendor SKU # differs. Upload the vendor spec PDF from the
              row in the table after saving.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
