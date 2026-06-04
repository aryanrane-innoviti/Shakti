import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { ConfirmModal } from '../components/Modal.jsx';

/**
 * Phase 3 (Report slice) — Audit Report detail / review.
 *
 * Thin client over the /audit-reports/:ain endpoints. One screen, three modes
 * driven by the API's status + is_* flags:
 *   - review     (Pending / Rejected, reviewer scope) → per-row decisions + Submit
 *   - incomplete (auditor hasn't completed)           → Cancel (reviewer) / info
 *   - readonly   (Approved / Rejected oversight)       → frozen tables + Download
 *
 * Every mutation is a REST call; the server is the source of truth (effective
 * row status, verdict, write-back) — the UI only renders and dispatches.
 */

const STATUS_BADGE = { Pending: 'warn', Incomplete: 'plain', Approved: 'active', Rejected: 'inactive' };
const ROW_TINT = {
  Approved: 'rgba(45, 106, 79, 0.08)',
  Rejected: 'rgba(155, 44, 44, 0.08)',
  Pending: 'transparent',
};

const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

function StatusPill({ status }) {
  return <span className={`badge ${STATUS_BADGE[status] || 'plain'} sm`}>{status}</span>;
}

const serialOf = (r) => r.expected_serial_number || r.unexpected_serial_number || r.unregistered_serial_number || '';
const serialKind = (r) =>
  r.expected_serial_number ? 'Expected' : r.unexpected_serial_number ? 'Unexpected' : 'Unregistered';

export default function AuditReportDetail() {
  const { ain } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'cancel' | 'submit' | null
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/audit-reports/${ain}`);
      setReport(r);
      setError(null);
    } catch (e) {
      setReport(null);
      setError(e.data?.error || e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [ain]);

  useEffect(() => { refresh(); }, [refresh]);

  // Per-row reviewer decision. Silent so rapid toggles don't flash the loader.
  const reviewRow = useCallback(async (kind, rowId, body) => {
    const seg = kind === 'serial' ? 'serial-rows' : 'accessory-rows';
    try {
      await api.patch(`/audit-reports/${ain}/${seg}/${rowId}`, body, { silent: true });
      await refresh();
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Update failed', 'error');
      refresh();
    }
  }, [ain, refresh, toast]);

  const doSubmit = async () => {
    setConfirm(null);
    setBusy(true);
    try {
      const updated = await api.post(`/audit-reports/${ain}/submit`);
      setReport(updated);
      toast.push(`Report ${ain} ${updated.status === 'Approved' ? 'approved' : 'rejected'}.`, 'success');
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Submit failed', 'error');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setConfirm(null);
    setBusy(true);
    try {
      await api.post(`/audit-reports/${ain}/cancel`);
      toast.push(`Report ${ain} cancelled.`, 'success');
      navigate('/audit-reports');
    } catch (e) {
      toast.push(e.data?.error || e.message || 'Cancel failed', 'error');
      setBusy(false);
      refresh();
    }
  };

  const doDownload = () => {
    api.download(`/audit-reports/${ain}/download`, `${ain}.xlsx`)
      .catch((e) => toast.push(e.message || 'Download failed', 'error'));
  };

  const allRows = useMemo(
    () => (report ? [...report.table1.rows, ...report.table2.rows] : []),
    [report]
  );
  const pendingCount = useMemo(() => allRows.filter((r) => r.effective_status === 'Pending').length, [allRows]);
  const verdict = useMemo(() => {
    if (allRows.some((r) => r.effective_status === 'Rejected')) return 'Rejected';
    if (allRows.some((r) => r.effective_status === 'Pending')) return 'Pending';
    return 'Approved';
  }, [allRows]);

  if (loading) {
    return (
      <>
        <div className="page-header"><h2>Audit Report</h2></div>
        <div className="card"><p className="meta">Loading…</p></div>
      </>
    );
  }
  if (error || !report) {
    return (
      <>
        <div className="page-header"><h2>Audit Report</h2></div>
        <div className="card">
          <p>{error || 'Report not found.'}</p>
          <Link to="/audit-reports">← Back to Audit Reports</Link>
        </div>
      </>
    );
  }

  const mode = report.is_reviewable ? 'review' : report.status === 'Incomplete' ? 'incomplete' : 'readonly';
  const editable = mode === 'review';

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>Audit Report <code>{report.audit_index}</code></h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {report.is_downloadable && <button className="primary" onClick={doDownload}>Download</button>}
          <Link to="/audit-reports"><button>Back</button></Link>
        </div>
      </div>

      {/* Header block */}
      <div className="card">
        <div className="report-header" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Field label="Status"><StatusPill status={report.status} /></Field>
          <Field label="Auditor">
            {`${report.auditor.first_name || ''} ${report.auditor.last_name || ''}`.trim()}
            <span className="muted"> · {report.auditor.role}</span>
            {report.auditor.email && <div className="muted">{report.auditor.email}</div>}
          </Field>
          <Field label="Location">
            {report.location.location_name}
            {report.location.vendor_name && <div className="muted">{report.location.vendor_name}</div>}
          </Field>
          <Field label="Created">{fmtDateTime(report.created_at)}</Field>
          <Field label="Auditor completed">{fmtDateTime(report.completed_at)}</Field>
          <Field label="Reviewed">{fmtDateTime(report.reviewed_at)}</Field>
        </div>
      </div>

      {mode === 'incomplete' && (
        <div className="card">
          {report.is_cancellable ? (
            <>
              <p>This audit has not been completed by the auditor yet. As a reviewer you can cancel it,
                which abandons the auditor's in-progress work.</p>
              <button className="danger" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel audit report</button>
            </>
          ) : (
            <p className="muted">This audit is still <strong>Incomplete</strong> — the auditor has not submitted it for review yet.</p>
          )}
        </div>
      )}

      {mode !== 'incomplete' && (
        <>
          {editable && (
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>Verdict on submit: </strong><StatusPill status={verdict} />
                {pendingCount > 0 && <span className="muted"> · {pendingCount} row(s) still pending a decision</span>}
              </div>
              <button className="primary" disabled={busy || pendingCount > 0} onClick={() => setConfirm('submit')}>
                Submit review
              </button>
            </div>
          )}

          <SerialTable rows={report.table1.rows} editable={editable} onReview={reviewRow} />
          <AccessoryTable rows={report.table2.rows} editable={editable} onReview={reviewRow} />
        </>
      )}

      {confirm === 'cancel' && (
        <ConfirmModal
          title="Cancel audit report"
          message="Cancel this audit and abandon the auditor's in-progress work? This cannot be undone."
          confirmLabel="Cancel audit"
          danger
          onConfirm={doCancel}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'submit' && (
        <ConfirmModal
          title="Submit review"
          message={
            verdict === 'Approved'
              ? 'Submit this review? The report will become Approved. This writes the audit’s findings back to the Master tables and cannot be undone.'
              : 'Submit this review? The report will become Rejected based on your row decisions.'
          }
          confirmLabel="Submit"
          onConfirm={doSubmit}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ReviewControls({ row, kind, rowId, onReview }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <button
        type="button"
        className={row.reviewer_status === 'Approved' ? 'primary' : ''}
        onClick={() => onReview(kind, rowId, { reviewer_status: 'Approved' })}
      >Approve</button>
      <button
        type="button"
        className={row.reviewer_status === 'Rejected' ? 'danger' : ''}
        onClick={() => onReview(kind, rowId, { reviewer_status: 'Rejected' })}
      >Reject</button>
      {row.reviewer_status && (
        <button type="button" title="Clear decision (back to auto)" onClick={() => onReview(kind, rowId, { reviewer_status: null })}>↺</button>
      )}
    </div>
  );
}

function RemarksCell({ row, kind, rowId, editable, onReview }) {
  if (!editable) return row.reviewer_remarks ? <span>{row.reviewer_remarks}</span> : <span className="muted">—</span>;
  return (
    <input
      // key on the stored value so an external refresh re-seeds the field.
      key={`${rowId}:${row.reviewer_remarks || ''}`}
      defaultValue={row.reviewer_remarks || ''}
      maxLength={500}
      placeholder="Reviewer remark"
      onBlur={(e) => {
        const v = e.target.value;
        if (v !== (row.reviewer_remarks || '')) onReview(kind, rowId, { reviewer_remarks: v.trim() ? v : null });
      }}
    />
  );
}

function SerialTable({ rows, editable, onReview }) {
  return (
    <div className="card table-wrap">
      <h3 style={{ marginTop: 0 }}>Table 1 — Serial-type SKUs</h3>
      <table>
        <thead><tr>
          <th>SKU</th>
          <th>Serial No.</th>
          <th>Matched</th>
          <th>Missing</th>
          <th>Working</th>
          <th>Auditor Remarks</th>
          <th>Effective</th>
          <th>Reviewer</th>
          <th>Reviewer Remarks</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#888' }}>No serial rows.</td></tr>}
          {rows.map((r) => {
            const rowId = r.audit_serial_row_id;
            return (
              <tr key={rowId} style={{ background: ROW_TINT[r.effective_status] }}>
                <td>
                  {r.vendor_sku_number_snapshot || r.sku_number_snapshot || '—'}
                  {(r.vendor_sku_name_snapshot || r.sku_name_snapshot) &&
                    <span className="muted"> {r.vendor_sku_name_snapshot || r.sku_name_snapshot}</span>}
                </td>
                <td><code>{serialOf(r)}</code> <span className="muted">{serialKind(r)}</span></td>
                <td>{r.matched ? '✓' : ''}</td>
                <td>{r.missing ? '✗' : ''}</td>
                <td>{r.working_status}</td>
                <td>{r.remarks || <span className="muted">—</span>}</td>
                <td><StatusPill status={r.effective_status} /></td>
                <td>
                  {editable
                    ? <ReviewControls row={r} kind="serial" rowId={rowId} onReview={onReview} />
                    : (r.reviewer_status ? <StatusPill status={r.reviewer_status} /> : <span className="muted">auto</span>)}
                </td>
                <td><RemarksCell row={r} kind="serial" rowId={rowId} editable={editable} onReview={onReview} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccessoryTable({ rows, editable, onReview }) {
  return (
    <div className="card table-wrap">
      <h3 style={{ marginTop: 0 }}>Table 2 — Accessories</h3>
      <table>
        <thead><tr>
          <th>Vendor SKU</th>
          <th>Expected</th>
          <th>Working</th>
          <th>Not Working</th>
          <th>Missing</th>
          <th>Effective</th>
          <th>Reviewer</th>
          <th>Reviewer Remarks</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#888' }}>No accessory rows.</td></tr>}
          {rows.map((r) => {
            const rowId = r.audit_accessory_row_id;
            return (
              <tr key={rowId} style={{ background: ROW_TINT[r.effective_status] }}>
                <td>
                  {r.vendor_sku_number || r.vendor_sku_number_snapshot || '—'}
                  {(r.vendor_sku_name || r.vendor_sku_name_snapshot) &&
                    <span className="muted"> {r.vendor_sku_name || r.vendor_sku_name_snapshot}</span>}
                </td>
                <td>{r.expected_quantity}</td>
                <td>{r.working_count}</td>
                <td>{r.not_working_count}</td>
                <td>{r.missing_count == null ? '—' : r.missing_count}</td>
                <td><StatusPill status={r.effective_status} /></td>
                <td>
                  {editable
                    ? <ReviewControls row={r} kind="accessory" rowId={rowId} onReview={onReview} />
                    : (r.reviewer_status ? <StatusPill status={r.reviewer_status} /> : <span className="muted">auto</span>)}
                </td>
                <td><RemarksCell row={r} kind="accessory" rowId={rowId} editable={editable} onReview={onReview} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
