import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

export default function SkuDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [sku, setSku] = useState(null);
  const [pdf, setPdf] = useState(null);

  const load = () => api.get(`/skus/${id}`).then(setSku);
  useEffect(() => { load(); }, [id]);

  if (!sku) return <div>Loading…</div>;

  const uploadSpec = async () => {
    if (!pdf) return;
    try {
      await api.upload(`/skus/${id}/specifications`, pdf);
      setPdf(null);
      load();
      toast.push('Spec uploaded', 'success');
    } catch (e) { toast.push(`Upload failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  const toggleStatus = async () => {
    const next = sku.status === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Mark this Innoviti SKU as ${next}?`)) return;
    try {
      await api.post(`/skus/${id}/status`);
      toast.push(`SKU marked ${next}`, 'success');
      load();
    } catch (e) { toast.push(`Failed: ${JSON.stringify(e.data || e.message)}`, 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <h2>{sku.sku_number} — {sku.sku_name}</h2>
        <button onClick={toggleStatus}>
          {sku.status === 'Active' ? 'Mark Inactive' : 'Mark Active'}
        </button>
      </div>
      <div className="card">
        <p><b>SKU Type:</b> {sku.sku_type_name} ({sku.serial_eligible ? 'serial-eligible' : 'no serial'})</p>
        <p><b>Tracking:</b> {sku.stm === 'Serial' ? 'Serial #' : 'Untracked'}</p>
        <p><b>Status:</b> <span className={`badge ${sku.status === 'Active' ? 'active' : 'inactive'}`}>{sku.status}</span></p>
        <p><b>Description:</b> {sku.description || '—'}</p>

        <h4 style={{ marginTop: 16, marginBottom: 4 }}>Innoviti SKU spec PDF</h4>
        <p className="help-text" style={{ marginTop: 0 }}>
          One file describing this SKU itself (Innoviti's datasheet). Replaces on every upload — only
          the latest is kept.
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
    </>
  );
}
