import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

const TABS = [
  { key: 'payment-terminal', label: 'Load Terminal Data' },
  { key: 'sim-card',         label: 'Load SIM Card Data' },
  { key: 'base-station',     label: 'Load Base Station Data' },
  { key: 'errors',           label: 'Loading Errors' },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));

export default function LoadStock() {
  const [params, setParams] = useSearchParams();
  const initialTab = TAB_KEYS.has(params.get('tab')) ? params.get('tab') : 'payment-terminal';
  const [tab, setTab] = useState(initialTab);
  const [focusedAttempt, setFocusedAttempt] = useState(null);

  // Keep URL in sync so the tab is shareable and refresh-stable.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (tab === 'payment-terminal') next.delete('tab');
    else next.set('tab', tab);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Operations · Stock</span>
          <h1>Load Stock</h1>
          <p className="meta">Upload CSV files to populate the Payment Terminal, SIM Card, and Base Station masters. Mapping is auto-suggested; tweak before loading.</p>
        </div>
      </div>

      <div className="filter-bar" role="tablist" aria-label="Load Stock tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'pill active' : 'pill'}
            onClick={() => { setTab(t.key); setFocusedAttempt(null); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'errors' ? (
        <LoadFlow
          kind={tab}
          onViewErrors={(attemptId) => { setTab('errors'); setFocusedAttempt(attemptId); }}
        />
      ) : (
        <LoadingErrors
          focusedAttempt={focusedAttempt}
          onSelect={(id) => setFocusedAttempt(id)}
          onClear={() => setFocusedAttempt(null)}
        />
      )}
    </>
  );
}

// =====================================================================
// LoadFlow — single upload + map + commit cycle for one kind.
// =====================================================================
function LoadFlow({ kind, onViewErrors }) {
  const toast = useToast();
  const [preview, setPreview] = useState(null); // { attempt_id, headers, suggested_mapping, target_fields, file_name, rows_total }
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [validationTried, setValidationTried] = useState(false);
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);

  // Reset everything when the tab (kind) changes
  useEffect(() => {
    setPreview(null);
    setMapping({});
    setResult(null);
    setValidationTried(false);
  }, [kind]);

  const accept = '.csv,.xlsx,.xls,text/csv,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const onFile = async (file) => {
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      toast.push('Only CSV or XLSX files are accepted.', 'error');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const p = await api.post(`/loads/${kind}/preview`, fd);
      setPreview(p);
      setMapping({ ...p.suggested_mapping });
    } catch (e) {
      const msg = e.data?.message || e.data?.error || e.message || 'Preview failed';
      toast.push(`Preview failed: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };

  const updateMapping = (field, header) => {
    setMapping((prev) => {
      const next = { ...prev };
      // Bijection: if this header was used elsewhere, clear that target.
      if (header) {
        for (const [k, v] of Object.entries(next)) {
          if (k !== field && v === header) next[k] = null;
        }
      }
      next[field] = header || null;
      return next;
    });
  };

  const requiredUnmapped =
    preview?.target_fields
      .filter((t) => t.required && !t.server_set)
      .some((t) => !mapping[t.field]);

  const doCommit = async () => {
    if (!preview) return;
    if (requiredUnmapped) {
      setValidationTried(true);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/loads/${kind}/commit`, {
        attempt_id: preview.attempt_id,
        file_name: preview.file_name,
        mapping,
      });
      setResult(r);
      setValidationTried(false);
      if (r.status === 'Success') toast.push(`Loaded ${r.rows_loaded} rows.`, 'success');
      else if (r.status === 'PartialSuccess') toast.push(`Loaded ${r.rows_loaded}, ${r.rows_failed} failed.`, 'warn');
      else toast.push(`No rows loaded. ${r.rows_failed} failed.`, 'error');
    } catch (e) {
      const msg = e.data?.message || e.data?.error || e.message || 'Commit failed';
      toast.push(`Commit failed: ${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    // Cancelling before commit — there's no DB row yet, only an orphan
    // file on disk. Fire-and-forget the cleanup endpoint.
    if (preview && !result) {
      api.del(`/loads/${kind}/preview/${preview.attempt_id}`).catch(() => {});
    }
    setPreview(null);
    setMapping({});
    setResult(null);
    setValidationTried(false);
  };

  const downloadTemplate = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const token = localStorage.getItem('shakti_token');
      const res = await fetch(`${base}/loads/${kind}/template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Could not download template');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}-template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err) {
      toast.push(err.message || 'Template download failed', 'error');
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!preview && (
        <div
          className={`upload-zone${drag ? ' drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
          aria-label="Upload CSV"
        >
          <div className="upload-icon" aria-hidden="true">⬆</div>
          <h3>Drop a CSV or XLSX file here</h3>
          <p className="meta">or click to browse · max 100 MB, 500 000 rows</p>
          <p className="meta" style={{ marginTop: 8 }}>
            New to this? <a href="#" onClick={downloadTemplate}>Download a CSV template</a> with the expected columns.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
          />
          {busy && <p style={{ marginTop: 12 }}>Reading file…</p>}
        </div>
      )}

      {preview && !result && (
        <MappingPanel
          preview={preview}
          mapping={mapping}
          onChange={updateMapping}
          onCancel={reset}
          onLoad={doCommit}
          busy={busy}
          requiredUnmapped={requiredUnmapped}
          validationTried={validationTried}
          onClearValidation={() => setValidationTried(false)}
        />
      )}

      {result && (
        <ResultPanel
          result={result}
          fileName={preview?.file_name}
          onAnother={reset}
          onViewErrors={() => onViewErrors(result.attempt_id)}
        />
      )}
    </div>
  );
}

// =====================================================================
// MappingPanel — left: source headers; right: target fields w/ dropdowns.
// Bijection enforced on parent via updateMapping. Server-set fields are
// hidden because they always get a default value on commit regardless of
// what the file says — showing them just clutters the UI.
// =====================================================================
const FIELD_LABELS = {
  sku_number: 'Innoviti SKU Number',
  vendor_sku_number: 'Vendor SKU Number',
  sim_card_number: 'SIM Card Number',
  serial_number: 'Serial Number',
  date_of_purchase: 'Date of Purchase',
  owner: 'Owner (Vendor)',
  description: 'Description',
};
function fieldLabel(snake) {
  return FIELD_LABELS[snake] ||
    snake.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function MappingPanel({ preview, mapping, onChange, onCancel, onLoad, busy, requiredUnmapped, validationTried, onClearValidation }) {
  const mappableTargets = preview.target_fields.filter((t) => !t.server_set);
  const requiredTargets = mappableTargets.filter((t) => t.required);
  const mappedCount = mappableTargets.filter((t) => mapping[t.field]).length;
  const requiredMappedCount = requiredTargets.filter((t) => mapping[t.field]).length;

  // Errors are only surfaced after the user has actually pressed Load —
  // before that, we don't want orange warnings/tints distracting them
  // while they're still mapping.
  const showValidation = validationTried && requiredUnmapped;
  const missingNames = mappableTargets
    .filter((t) => t.required && !mapping[t.field])
    .map((t) => fieldLabel(t.field));

  return (
    <div>
      <div className="mapping-head">
        <div className="mapping-head-info">
          <div className="mapping-head-title">{preview.file_name}</div>
          <div className="meta mapping-head-meta">
            {preview.rows_total.toLocaleString()} rows · {preview.headers.length} columns ·
            {' '}{mappedCount} of {mappableTargets.length} fields mapped
            {requiredTargets.length > 0 && ` (${requiredMappedCount}/${requiredTargets.length} required)`}
          </div>
        </div>
        <div className="row-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" onClick={onLoad} disabled={busy}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {showValidation && (
        <div className="mapping-warn">
          <div className="mapping-warn-text">
            <strong>Can't load yet.</strong>{' '}
            {missingNames.length === 1
              ? `Map a source column for ${missingNames[0]} before loading.`
              : `Map source columns for ${missingNames.join(', ')} before loading.`}
          </div>
          <button onClick={onClearValidation} className="ghost-warn">Clear</button>
        </div>
      )}

      <table className="mapping-table">
        <thead>
          <tr><th>Field</th><th>Source column from file</th></tr>
        </thead>
        <tbody>
          {mappableTargets.map((t) => {
            const unmapped = !mapping[t.field];
            const missingRequired = showValidation && t.required && unmapped;
            return (
              <tr key={t.field} className={missingRequired ? 'row-missing' : ''}>
                <td>
                  <div className="mapping-target-name">
                    {fieldLabel(t.field)}
                    {t.required && <span className="req-dot" title="required" aria-label="required">●</span>}
                  </div>
                </td>
                <td>
                  <select
                    value={mapping[t.field] || ''}
                    onChange={(e) => onChange(t.field, e.target.value)}
                  >
                    <option value="">— unmapped —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// =====================================================================
// ResultPanel — shown after commit.
// =====================================================================
function ResultPanel({ result, fileName, onAnother, onViewErrors }) {
  const tone = result.status === 'Success' ? 'success' : result.status === 'PartialSuccess' ? 'warn' : 'error';
  return (
    <div>
      <h3>
        {result.status === 'Success' && 'Loaded.'}
        {result.status === 'PartialSuccess' && 'Loaded with errors.'}
        {result.status === 'Failure' && 'Nothing loaded.'}
      </h3>
      <p className="meta">{fileName} · attempt <span className="mono">{result.attempt_id}</span></p>
      <div className="result-grid">
        <div className="result-stat"><div className="num">{result.rows_total}</div><div className="lbl">total rows</div></div>
        <div className={`result-stat ${tone === 'success' ? 'good' : ''}`}><div className="num">{result.rows_loaded}</div><div className="lbl">loaded</div></div>
        <div className={`result-stat ${result.rows_failed > 0 ? 'bad' : ''}`}><div className="num">{result.rows_failed}</div><div className="lbl">failed</div></div>
      </div>
      {result.dropped_targets?.length > 0 && (
        <p className="help-text">
          Server-set fields ignored from mapping: <span className="mono">{result.dropped_targets.join(', ')}</span>
        </p>
      )}

      {result.rows_failed > 0 && (
        <div className="result-summary">
          <p className="result-summary-line">
            <strong>{result.rows_failed.toLocaleString()}</strong> rows didn't load. Open the Loading Errors tab for the full breakdown — or grab the XLSX report there.
          </p>
          {result.errors_by_code && Object.keys(result.errors_by_code).length > 0 && (
            <div className="error-code-chips">
              {Object.entries(result.errors_by_code)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => (
                  <span key={code} className="badge warn">{code} · {count.toLocaleString()}</span>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="row-actions" style={{ marginTop: 16 }}>
        <button onClick={onAnother}>Load another file</button>
        {result.rows_failed > 0 && (
          <button className="primary" onClick={onViewErrors}>Open in Loading Errors tab</button>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// LoadingErrors — list of attempts + detail view for one.
// =====================================================================
function LoadingErrors({ focusedAttempt, onSelect, onClear }) {
  const toast = useToast();
  const [attempts, setAttempts] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState({ kind: '', status: '' });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api.get('/loads/attempts' + (q ? '?' + q : '')).then(setAttempts);
  }, [filter, reloadTick]);

  const deleteOne = async (e, attemptId, fileName) => {
    e.stopPropagation();
    if (!confirm(`Delete the load attempt for "${fileName}"? This removes its errors and uploaded file.`)) return;
    try {
      await api.del(`/loads/attempts/${attemptId}`);
      toast.push('Attempt deleted', 'success');
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast.push(err.data?.error || 'Delete failed', 'error');
    }
  };

  const clearAll = async () => {
    const visible = attempts?.length || 0;
    if (!visible) return;
    const filterDesc = [filter.kind && `kind=${filter.kind}`, filter.status && `status=${filter.status}`].filter(Boolean).join(', ');
    const scope = filterDesc ? `the ${visible} attempts matching ${filterDesc}` : `all ${visible} attempts`;
    if (!confirm(`Delete ${scope}? Errors and uploaded files are removed too. This can't be undone.`)) return;
    try {
      const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const r = await api.del('/loads/attempts' + (q ? '?' + q : ''));
      toast.push(`Cleared ${r.deleted} attempts`, 'success');
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast.push(err.data?.error || 'Clear failed', 'error');
    }
  };

  useEffect(() => {
    if (focusedAttempt) {
      api.get(`/loads/attempts/${focusedAttempt}`).then(setDetail);
    } else {
      setDetail(null);
    }
  }, [focusedAttempt]);

  if (detail) {
    const totalErrors = detail.rows_failed || 0;

    const downloadErrorsXlsx = async () => {
      try {
        const base = import.meta.env.VITE_API_URL || 'http://localhost:4000';
        const token = localStorage.getItem('shakti_token');
        const res = await fetch(`${base}/loads/attempts/${detail.attempt_id}/errors.xlsx`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('Could not download');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(detail.file_name || 'load').replace(/\.(csv|xlsx?)$/i, '')}-errors.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
      } catch (e) {
        alert('Failed to download errors: ' + (e.message || 'unknown'));
      }
    };

    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="mapping-head">
          <div className="mapping-head-info">
            <div className="mapping-head-title">{detail.file_name}</div>
            <div className="meta mapping-head-meta">
              {detail.kind} · {detail.status} · {Number(detail.rows_loaded).toLocaleString()} / {Number(detail.rows_total).toLocaleString()} loaded
            </div>
            <div className="meta" style={{ marginTop: 2 }}>
              Attempt <span className="mono">{detail.attempt_id}</span> · by {detail.user_first_name} {detail.user_last_name}
            </div>
          </div>
          <div className="row-actions">
            <button onClick={onClear}>← Back</button>
            {totalErrors > 0 && (
              <button className="primary" onClick={downloadErrorsXlsx}>
                Download errors (XLSX)
              </button>
            )}
          </div>
        </div>

        {detail.fatal_error_code && (
          <div className="mapping-warn" style={{ marginBottom: 16 }}>
            <div className="mapping-warn-text">
              <strong>File-level failure ({detail.fatal_error_code}):</strong> {detail.fatal_error_message}
            </div>
          </div>
        )}

        {totalErrors === 0 ? (
          <div className="empty"><h4>No errors</h4><p>Every row in this file loaded successfully.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: '60%' }}>Error type</th><th>Occurrences</th></tr>
              </thead>
              <tbody>
                {Object.entries(detail.errors_by_code || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <tr key={code}>
                      <td><span className="badge warn">{code}</span></td>
                      <td>{count.toLocaleString()}</td>
                    </tr>
                  ))}
                <tr>
                  <td style={{ fontWeight: 500 }}>Total</td>
                  <td style={{ fontWeight: 500 }}>{totalErrors.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
            <option value="">Any kind</option>
            <option value="payment_terminal">Payment Terminal</option>
            <option value="sim_card">SIM Card</option>
            <option value="base_station">Base Station</option>
          </select>
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">Any status</option>
            <option value="Success">Success</option>
            <option value="PartialSuccess">PartialSuccess</option>
            <option value="Failure">Failure</option>
          </select>
        </div>
        {attempts && attempts.length > 0 && (
          <button onClick={clearAll} className="danger">Clear all</button>
        )}
      </div>
      <div className="table-wrap">
        {attempts === null ? (
          <p style={{ padding: 12 }}>Loading…</p>
        ) : attempts.length === 0 ? (
          <div className="empty"><h4>No load attempts yet.</h4><p>Upload a CSV from one of the Load tabs to begin.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th><th>Kind</th><th>File</th><th>Total</th><th>Loaded</th><th>Failed</th>
                <th>Status</th><th>Uploaded by</th><th></th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attempt_id} onClick={() => onSelect(a.attempt_id)} style={{ cursor: 'pointer' }}>
                  <td>{a.started_at ? new Date(a.started_at).toLocaleString() : '—'}</td>
                  <td>{a.kind}</td>
                  <td className="mono">{a.file_name}</td>
                  <td>{a.rows_total}</td>
                  <td>{a.rows_loaded}</td>
                  <td>{a.rows_failed}</td>
                  <td><span className={`badge ${a.status === 'Success' ? 'active' : a.status === 'PartialSuccess' ? 'warn' : a.status === 'Failure' ? 'inactive' : ''}`}>{a.status}</span></td>
                  <td>{a.user_first_name} {a.user_last_name}</td>
                  <td>
                    <button
                      className="ghost"
                      onClick={(e) => deleteOne(e, a.attempt_id, a.file_name)}
                      title="Delete this attempt and its errors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
