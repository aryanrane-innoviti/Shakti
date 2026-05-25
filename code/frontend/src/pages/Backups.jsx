import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { ConfirmModal } from '../components/Modal.jsx';

export default function Backups() {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [name, setName] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = () => api.get('/backup').then(setFiles);
  useEffect(() => { load(); }, []);

  const doBackup = async () => {
    try {
      await api.post('/backup', { filename: name });
      setName('');
      load();
      toast.push('Backup created', 'success');
    } catch (e) { toast.push(`Failed: ${e.data?.error || e.message}`, 'error'); }
  };

  const doRestore = async () => {
    const f = confirmRestore;
    setConfirmRestore(null);
    try {
      const r = await api.post('/backup/restore', { filename: f.name });
      toast.push(r.note || 'Restored', 'success');
    } catch (e) { toast.push(`Failed: ${e.data?.error || e.message}`, 'error'); }
  };

  const doReset = async () => {
    setConfirmReset(false);
    try {
      const r = await api.post('/backup/reset');
      load();
      toast.push(r.note || 'Database reset to seeded values', 'success');
    } catch (e) {
      const detail = e.data?.message || e.data?.error || e.message;
      toast.push(`Reset failed: ${detail}`, 'error');
    }
  };

  const doDelete = async () => {
    const f = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.del(`/backup/${encodeURIComponent(f.name)}`);
      toast.push(`Deleted ${f.name}`, 'success');
      load();
    } catch (e) { toast.push(`Delete failed: ${e.data?.error || e.message}`, 'error'); }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Governance · Section 1.7</span>
          <h2>Backups</h2>
          <p className="meta">
            Daily snapshots run automatically. SA can also trigger an ad-hoc snapshot or
            restore the live database from any stored file. Deleting a backup is permanent.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>Create snapshot</h3>
        <div className="row" style={{ gap: 8 }}>
          <input placeholder="Filename (e.g. before-rollout)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={doBackup}>Backup now</button>
        </div>
        <p className="help-text">Backups include user password hashes and stored credentials.</p>
      </div>

      <div className="card table-wrap">
        <h3>Stored snapshots</h3>
        {files.length === 0 ? (
          <div className="empty"><h4>No snapshots yet.</h4><p>Create one above to get started.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Size</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>{(f.size / 1024).toFixed(1)} KB</td>
                  <td>{f.created_at}</td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => setConfirmRestore(f)}>Restore</button>
                      <button className="danger" onClick={() => setConfirmDelete(f)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 'var(--r-5)' }}>
        <h3>Reset database</h3>
        <p className="help-text">
          Wipes all data and restores the database to its original seeded values
          (default user types, vendor types, SKU types and the Super Admin account).
          Use this to get a clean slate before testing a backup upload.
        </p>
        <button className="danger" onClick={() => setConfirmReset(true)}>Reset to seeded state</button>
      </div>

      {confirmRestore && (
        <ConfirmModal
          title="Overwrite database?"
          message={`Restore from "${confirmRestore.name}"? This overwrites the live database with the snapshot's contents.`}
          confirmLabel="Restore"
          danger
          onClose={() => setConfirmRestore(null)}
          onConfirm={doRestore}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title="Reset database?"
          message="This permanently deletes ALL data and restores the database to its original seeded values. This cannot be undone — create a backup first if you need the current data."
          confirmLabel="Reset to seed"
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={doReset}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete backup?"
          message={`Permanently delete the snapshot "${confirmDelete.name}"? This cannot be undone — the file will be removed from disk.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </>
  );
}
