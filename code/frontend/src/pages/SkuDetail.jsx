import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Modal from '../components/Modal.jsx';

export default function SkuDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [sku, setSku] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [edit, setEdit] = useState(null);
  const [editMode, setEditMode] = useState('add');
  const [pdf, setPdf] = useState(null);
  const supplierPdfRefs = useRef({});

  const load = () => api.get(`/skus/${id}`).then(setSku);
  useEffect(() => { load(); api.get('/vendors').then(setVendors); }, [id]);

  if (!sku) return <div>Loading…</div>;

  const saveSupplier = async () => {
    try {
      if (editMode === 'add') {
        await api.post(`/skus/${id}/vendors`, edit);
        toast.push('Supplier added', 'success');
      } else {
        await api.patch(`/skus/${id}/vendors/${edit.sku_vendor_assoc_id}`, {
          vendor_sku_number: edit.vendor_sku_number,
          vendor_sku_price_moq: edit.vendor_sku_price_moq,
          vendor_sku_price_unit: edit.vendor_sku_price_unit,
        });
        toast.push('Supplier updated', 'success');
      }
      setEdit(null);
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const removeSupplier = async (assoc_id) => {
    if (!confirm('Remove this supplier row?')) return;
    await api.del(`/skus/${id}/vendors/${assoc_id}`);
    load();
  };

  const uploadSpec = async () => {
    if (!pdf) return;
    try {
      await api.upload(`/skus/${id}/specifications`, pdf);
      setPdf(null);
      load();
      toast.push('Spec uploaded', 'success');
    } catch (e) { toast.push(`Upload failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const uploadSupplierSpec = async (assoc_id, file) => {
    if (!file) return;
    try {
      await api.upload(`/skus/${id}/vendors/${assoc_id}/specification`, file);
      load();
      toast.push('Vendor spec uploaded', 'success');
    } catch (e) { toast.push(`Upload failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const toggleStatus = async () => {
    await api.post(`/skus/${id}/status`);
    load();
  };

  return (
    <>
      <div className="page-header">
        <h2>{sku.sku_number} — {sku.sku_name}</h2>
        <button onClick={toggleStatus}>Toggle status</button>
      </div>
      <div className="card">
        <p><b>SKU Type:</b> {sku.sku_type_name} ({sku.serial_eligible ? 'serial-eligible' : 'no serial'})</p>
        <p><b>Tracking:</b> {sku.stm === 'Serial' ? 'Serial #' : 'Untracked'}</p>
        <p><b>Status:</b> <span className={`badge ${sku.status === 'Active' ? 'active' : 'inactive'}`}>{sku.status}</span></p>
        <p><b>Description:</b> {sku.description || '—'}</p>
        {sku.parent_sku_name && <p><b>Parent SKU:</b> {sku.parent_sku_name}</p>}

        <h4 style={{ marginTop: 16, marginBottom: 4 }}>Innoviti SKU spec PDF</h4>
        <p className="help-text" style={{ marginTop: 0 }}>
          One file describing this SKU itself (Innoviti's datasheet). Replaces on every upload — only
          the latest is kept. This is <em>different</em> from the per-supplier vendor spec PDFs in
          the Suppliers section below.
        </p>
        <p>
          {sku.specifications_pdf
            ? <code title={String(sku.specifications_pdf).split(/[\\/]/).pop()}>{String(sku.specifications_pdf).split(/[\\/]/).pop()}</code>
            : <span className="muted">none uploaded</span>}
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files[0])} />
          <button className="primary" onClick={uploadSpec} disabled={!pdf}>
            {sku.specifications_pdf ? 'Replace SKU spec (10 MB max)' : 'Upload SKU spec (10 MB max)'}
          </button>
        </div>
      </div>

      {(sku.adaptors?.length > 0 || sku.usb_cables?.length > 0 || sku.parent) && (
        <div className="card">
          <h3>Payment Terminal components</h3>
          <p className="help-text" style={{ marginTop: 0 }}>
            Referenced Adaptor / USB / Parent SKUs. Items shown in <span style={{ color: '#c0392b' }}>red</span> are
            Inactive — the reference is stale and should be replaced.
          </p>
          {sku.parent && (
            <p><b>Parent SKU:</b> <Link to={`/terminal-parent-skus`}>{sku.parent.parent_sku_number} — {sku.parent.name}</Link></p>
          )}
          {sku.adaptors?.length > 0 && (
            <>
              <h4>Adaptors</h4>
              <ul>
                {sku.adaptors.map((a) => (
                  <li key={a.sku_id} style={a.status === 'Inactive' ? { color: '#c0392b' } : null}>
                    <Link to={`/skus/${a.sku_id}`} style={a.status === 'Inactive' ? { color: '#c0392b' } : null}>
                      {a.sku_number} — {a.sku_name}
                    </Link>
                    {a.status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sku.usb_cables?.length > 0 && (
            <>
              <h4>USB cables</h4>
              <ul>
                {sku.usb_cables.map((u) => (
                  <li key={u.sku_id} style={u.status === 'Inactive' ? { color: '#c0392b' } : null}>
                    <Link to={`/skus/${u.sku_id}`} style={u.status === 'Inactive' ? { color: '#c0392b' } : null}>
                      {u.sku_number} — {u.sku_name}
                    </Link>
                    {u.status === 'Inactive' && <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>Suppliers (vendor SKU rows · all peers, no primary)</h3>
        <p className="help-text" style={{ marginTop: 0 }}>
          Each row is a distinct (vendor × vendor SKU #) supplier with its own pricing and
          <b> vendor spec PDF</b>. The vendor's spec PDF here is separate from the Innoviti SKU spec
          PDF above.
        </p>
        {sku.suppliers.length === 0 && (
          <p style={{ color: '#a15c00' }}>⚠ No supplier rows — this SKU is not fully defined.</p>
        )}
        <table>
          <thead><tr><th>Vendor</th><th>Vendor SKU #</th><th>MOQ</th><th>Unit price</th><th>Vendor Spec PDF</th><th></th></tr></thead>
          <tbody>
            {sku.suppliers.map((s) => (
              <tr key={s.sku_vendor_assoc_id}>
                <td>{s.vendor_name}{s.vendor_status === 'Inactive' ? <span className="badge inactive" style={{ marginLeft: 6 }}>Inactive</span> : ''}</td>
                <td>{s.vendor_sku_number}</td>
                <td>{s.vendor_sku_price_moq || '—'}</td>
                <td>{s.vendor_sku_price_unit || '—'}</td>
                <td title={s.vendor_sku_specification_pdf ? String(s.vendor_sku_specification_pdf).split(/[\\/]/).pop() : ''}>
                  <input
                    ref={(el) => { supplierPdfRefs.current[s.sku_vendor_assoc_id] = el; }}
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      if (f) { uploadSupplierSpec(s.sku_vendor_assoc_id, f); e.target.value = ''; }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => supplierPdfRefs.current[s.sku_vendor_assoc_id]?.click()}
                  >
                    {s.vendor_sku_specification_pdf ? 'Replace' : 'Upload'}
                  </button>
                </td>
                <td>
                  <button onClick={() => { setEditMode('edit'); setEdit({ ...s }); }}>Modify</button>{' '}
                  <button onClick={() => removeSupplier(s.sku_vendor_assoc_id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="primary"
          style={{ marginTop: 12 }}
          onClick={() => { setEditMode('add'); setEdit({ vendor_id: '', vendor_sku_number: '', vendor_sku_price_moq: '', vendor_sku_price_unit: '' }); }}
        >+ Add Supplier</button>
      </div>

      {edit && (
        <Modal
          title={editMode === 'add' ? 'Add supplier row' : 'Modify supplier row'}
          onClose={() => setEdit(null)}
          actions={<><button onClick={() => setEdit(null)}>Cancel</button><button className="primary" onClick={saveSupplier}>{editMode === 'add' ? 'Add' : 'Save'}</button></>}
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
            <div><label>Vendor SKU # *</label><input value={edit.vendor_sku_number || ''} onChange={(e) => setEdit({ ...edit, vendor_sku_number: e.target.value })} /></div>
            <div>
              <label>MOQ</label>
              <input
                type="number"
                min="1"
                step="1"
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
                type="number"
                min="0"
                step="0.01"
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
          </div>
          {editMode === 'edit' && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
              To replace the vendor spec PDF, use the upload control in the suppliers table row.
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
