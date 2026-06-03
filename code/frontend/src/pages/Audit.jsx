import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { ConfirmModal } from '../components/Modal.jsx';

// Lazy-loaded so the ZXing barcode engine (~450 kB) is only fetched when the
// auditor actually opens the camera — it stays out of the initial bundle.
const BarcodeScanner = lazy(() => import('../components/BarcodeScanner.jsx'));

// Distinct, high-contrast accents cycled across the SKU names in Table 1 so the
// ASO can tell one physical model's rows apart from another's at a glance.
const SKU_ACCENTS = [
  '#5b2a86', '#ee7b30', '#2d6a4f', '#9b2c2c', '#1d4e89',
  '#7d5ba6', '#b5651d', '#0f766e', '#a23e48', '#475569',
];

// Maps a serial row's bucket to a badge colour class (see styles.css .badge.*).
const STATUS_BADGE = {
  Matched: 'active',       // expected unit found by a scan (green)
  Missing: 'inactive',     // expected unit not found after submit (red)
  Unexpected: 'warn',      // in a master, but not expected here (orange)
  Unregistered: 'purple',  // in no master at all (purple)
  Expected: 'plain',       // expected, not yet scanned (neutral)
};

/**
 * Phase 3 (ASO slice) — Audit Session screen.
 *
 * Render states (driven by GET /audit-sessions/current):
 *   1. { status: 'none' }            → Start button
 *   2. { status: 'PendingReview' }   → Block banner only
 *   3. full Incomplete payload       → Header + Table 1 + Table 2 + Complete/Cancel
 */
export default function Audit() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState(null);   // {status: 'none' | 'PendingReview' | full session}
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const cur = await api.get('/audit-sessions/current');
      setCurrent(cur);
    } catch (e) {
      toast.push(e.message || 'Failed to load current audit', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <>
        <div className="page-header"><div><span className="eyebrow">Audit</span><h1>Audit</h1></div></div>
        <div className="card"><p className="meta">Loading…</p></div>
      </>
    );
  }

  // State 2: PendingReview block.
  if (current && current.status === 'PendingReview') {
    return (
      <>
        <div className="page-header"><div><span className="eyebrow">Audit</span><h1>Audit</h1></div></div>
        <div className="card">
          <p style={{ fontWeight: 600 }}>
            Previous audit {current.audit_index} is awaiting Store review. Cannot start a new audit
            by the same user until the previous audit review is closed.
          </p>
        </div>
      </>
    );
  }

  // State 1: no session — show Start button.
  if (!current || current.status === 'none') {
    return (
      <StartView
        user={user}
        onStarted={(session) => setCurrent(session)}
      />
    );
  }

  // State 3: active Incomplete session — render the full PAR UI.
  return (
    <SessionView
      session={current}
      onChanged={(updated) => setCurrent(updated)}
      onReset={refresh}
    />
  );
}

// ===================================================================
// Start view — no session exists yet
// ===================================================================
function StartView({ user, onStarted }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [blockMessage, setBlockMessage] = useState(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await api.post('/audit-sessions');
      toast.push(`Audit ${session.audit_index} started`, 'success');
      onStarted(session);
    } catch (e) {
      const msg = e?.data?.error || e.message || 'Failed to start audit';
      if (e?.data?.code === 'audit_location_not_assigned') {
        setBlockMessage(msg);
      } else {
        toast.push(msg, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Audit</span>
          <h1>Audit</h1>
          <p className="meta">Start a new audit session at your assigned location.</p>
        </div>
      </div>

      {blockMessage ? (
        <div className="card">
          <p className="error-text" style={{ marginTop: 0 }}>{blockMessage}</p>
        </div>
      ) : (
        <div className="card">
          <button className="primary" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : `Start Audit Session — ${fullName || 'You'}`}
          </button>
        </div>
      )}
    </>
  );
}

// ===================================================================
// SessionView — Incomplete session, render Tables + Complete/Cancel
// ===================================================================
function SessionView({ session, onChanged, onReset }) {
  const toast = useToast();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const fmtTs = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

  const doComplete = async () => {
    setConfirmComplete(false);
    try {
      await api.post(`/audit-sessions/${session.audit_session_id}/complete`);
      toast.push(`Audit ${session.audit_index} submitted for Store review.`, 'success');
      onReset();
    } catch (e) {
      const msg = e?.data?.error || e.message || 'Failed to complete audit';
      toast.push(msg, 'error');
    }
  };

  const doCancel = async () => {
    setConfirmCancel(false);
    try {
      await api.post(`/audit-sessions/${session.audit_session_id}/cancel`);
      toast.push(`Audit ${session.audit_index} cancelled.`, 'info');
      onReset();
    } catch (e) {
      const msg = e?.data?.error || e.message || 'Failed to cancel audit';
      toast.push(msg, 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Audit · {session.audit_index}</span>
          <h1>Provisional Audit Report (PAR) {session.audit_index}</h1>
          <p className="meta">
            <strong>Location:</strong> {session.location_snapshot_name} ·{' '}
            <strong>Auditor:</strong> {session.auditor_name} ·{' '}
            <strong>Started:</strong> {fmtTs(session.started_at)}
          </p>
        </div>
        <div className="row-actions">
          <button className="primary" onClick={() => setConfirmComplete(true)}>
            Complete Audit Session {session.audit_index}
          </button>
          <button className="danger" onClick={() => setConfirmCancel(true)}>
            Cancel Audit Session {session.audit_index}
          </button>
        </div>
      </div>

      {session.auto_suspended_at && (
        <div className="card" role="status" aria-live="polite" style={{ background: '#fffaf0' }}>
          Auto-suspended after 30 minutes of inactivity — resume by scanning or editing below.
        </div>
      )}

      <Table1Panel
        session={session}
        onSessionChange={onChanged}
      />

      {session.table1_state === 'Submitted' || session.table2_rows?.length > 0 ? (
        <Table2Panel
          session={session}
          onSessionChange={onChanged}
        />
      ) : (
        <div className="card">
          <p className="meta">Table 2 (Accessories) will appear after you submit Table 1.</p>
        </div>
      )}

      {confirmComplete && (
        <ConfirmModal
          title="Complete Audit Session"
          message="Complete this audit and submit the PAR for Store review? This freezes Table 1 and Table 2 and cannot be undone from this screen."
          confirmLabel="Complete"
          onConfirm={doComplete}
          onClose={() => setConfirmComplete(false)}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Cancel Audit Session"
          message="Cancel this audit? The PAR will not be retained. This cannot be undone."
          confirmLabel="Cancel audit"
          danger
          onConfirm={doCancel}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </>
  );
}

// ===================================================================
// Table 1 — Serial-type SKUs (scan-driven)
// ===================================================================
function Table1Panel({ session, onSessionChange }) {
  const toast = useToast();
  const scanRef = useRef(null);
  const [scanValue, setScanValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState([]);
  // Selection holds the index into `targets` (as a string), or '' for none.
  const [selected, setSelected] = useState('');
  const [scanningBarcode, setScanningBarcode] = useState(false);
  const rows = session.table1_rows || [];
  const isFrozen = session.table1_state !== 'Editing';

  // The ASO physically handles several different models at once and can only
  // read the serial number + SKU name off each device. The table rows are
  // ordered by category (expected/unexpected/unregistered), not by model, so we
  // give every distinct SKU name a stable accent colour: same model → same bar
  // + dot, letting the eye group a model's units no matter where they sit.
  const rowSkuName = (r) =>
    r.vendor_sku_name_snapshot || (r.master_kind === 'sim_card' ? r.sku_name_snapshot : '—');

  const skuColorMap = useMemo(() => {
    const map = new Map();
    let i = 0;
    for (const r of rows) {
      const name = rowSkuName(r);
      if (!map.has(name)) { map.set(name, SKU_ACCENTS[i % SKU_ACCENTS.length]); i++; }
    }
    return map;
  }, [rows]);

  // Per-serial decoration: collapse the three serial columns + matched/missing
  // flags into one serial value and one status bucket (the column it lands in).
  const statusFor = (r) => {
    if (r.expected_serial_number != null) {
      return r.matched ? 'Matched' : (r.missing ? 'Missing' : 'Expected');
    }
    if (r.unexpected_serial_number != null) return 'Unexpected';
    return 'Unregistered';
  };
  const serialFor = (r) =>
    r.expected_serial_number ?? r.unexpected_serial_number ?? r.unregistered_serial_number ?? '';

  // Summary sub-table: one row per SKU/model with the counts that matter to the
  // store (how many expected, found, missing, and the off-book extras).
  const summary = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const name = rowSkuName(r);
      let s = map.get(name);
      if (!s) {
        s = { name, accent: skuColorMap.get(name), expected: 0, matched: 0, missing: 0, unexpected: 0, unregistered: 0 };
        map.set(name, s);
      }
      if (r.expected_serial_number != null) {
        s.expected++;
        if (r.matched) s.matched++;
        if (r.missing) s.missing++;
      } else if (r.unexpected_serial_number != null) {
        s.unexpected++;
      } else {
        s.unregistered++;
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, skuColorMap]);

  // Serial detail table: one row per unit, grouped by model then status so a
  // model's units sit together.
  const detail = useMemo(() => {
    const rank = { Matched: 0, Unexpected: 1, Unregistered: 2, Expected: 3, Missing: 4 };
    return rows
      .map((r) => ({ r, name: rowSkuName(r), accent: skuColorMap.get(rowSkuName(r)), serial: serialFor(r), status: statusFor(r) }))
      .sort((a, b) =>
        a.name.localeCompare(b.name) ||
        (rank[a.status] - rank[b.status]) ||
        String(a.serial).localeCompare(String(b.serial)));
  }, [rows, skuColorMap]);

  // Load the SKU picker list once. A serial is only unique within a Vendor SKU,
  // so the ASO picks a SKU first, then enters the serial. The list groups Vendor
  // SKUs by model name (vendor-agnostic) — see /table1/scan-targets.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/audit-sessions/${session.audit_session_id}/table1/scan-targets`);
        if (!cancelled) setTargets(res.targets || []);
      } catch {
        if (!cancelled) setTargets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [session.audit_session_id]);

  // Vendor-agnostic label: a model carried by two vendors collapses to one entry,
  // so we show the model name and its type — never the vendor.
  const targetLabel = (t) => `${t.label} · ${t.type_name}`;

  const bodyForSelection = () => {
    const t = targets[Number(selected)];
    if (!t) return null;
    if (t.kind === 'vendor_sku') return { vendor_sku_ids: t.vendor_sku_ids };
    if (t.kind === 'sim_sku') return { sku_id: t.sku_id };
    return null;
  };

  // Single code path for adding a serial — used by both manual entry (the form)
  // and the camera barcode reader. Takes the value explicitly so the barcode
  // callback never races React's async state update.
  const addSerial = async (rawValue) => {
    const value = (rawValue || '').trim();
    if (!value || busy || isFrozen) return;
    const sel = bodyForSelection();
    if (!sel) {
      toast.push('Select a SKU before entering a serial.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(
        `/audit-sessions/${session.audit_session_id}/table1/scan`,
        { ...sel, serial_number: value }
      );
      setScanValue('');
      const refreshed = await api.get(`/audit-sessions/${session.audit_session_id}`);
      onSessionChange(refreshed);
      // Keep the model selected so several units of it scan back-to-back.
      if (scanRef.current) scanRef.current.focus();
    } catch (e) {
      const msg = e?.data?.error || e.message || 'Scan failed';
      toast.push(msg, 'error');
      setScanValue(value); // keep the value visible so the user can correct it
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitScan = (e) => {
    if (e) e.preventDefault();
    addSerial(scanValue);
  };

  // A barcode read fills the serial in and adds it immediately (hands-free),
  // matching how a hardware scanner would behave.
  const handleBarcodeDetected = (text) => {
    setScanningBarcode(false);
    setScanValue(text);
    addSerial(text);
  };

  const toggleWorking = async (row) => {
    if (isFrozen) return;
    const next = row.working_status === 'Working' ? 'Not Working' : 'Working';

    // Optimistic: flip the pill in local state right away so the tap feels
    // instant, then PATCH in the background. Previously we awaited the PATCH
    // *and* a full-session GET before any feedback — two round-trips of lag per
    // tap. A working_status change touches only this one row, so there's
    // nothing else to refetch; on failure we roll the row back.
    const applyStatus = (ws) => onSessionChange({
      ...session,
      auto_suspended_at: ws === next ? null : session.auto_suspended_at,
      table1_rows: (session.table1_rows || []).map((r) =>
        r.audit_serial_row_id === row.audit_serial_row_id ? { ...r, working_status: ws } : r
      ),
    });

    applyStatus(next);
    try {
      await api.patch(
        `/audit-sessions/${session.audit_session_id}/table1/rows/${row.audit_serial_row_id}`,
        { working_status: next },
        { silent: true }
      );
    } catch (e) {
      applyStatus(row.working_status); // revert
      toast.push(e?.data?.error || e.message || 'Update failed', 'error');
    }
  };

  const submitTable = async () => {
    try {
      const updated = await api.post(`/audit-sessions/${session.audit_session_id}/table1/submit`);
      onSessionChange(updated);
      toast.push('Table 1 submitted.', 'success');
    } catch (e) {
      toast.push(e?.data?.error || e.message || 'Submit failed', 'error');
    }
  };

  const modifyTable = async () => {
    try {
      const updated = await api.post(`/audit-sessions/${session.audit_session_id}/table1/modify`);
      onSessionChange(updated);
      toast.push('Table 1 re-opened for editing.', 'info');
    } catch (e) {
      toast.push(e?.data?.error || e.message || 'Modify failed', 'error');
    }
  };

  // Render order: expected (seed order), unexpected (by scanned_at), unregistered (by scanned_at).
  // Backend already orders this way, so we render as-is.
  return (
    <div className="card">
      <div>
        <h2 style={{ marginTop: 0 }}>Table 1 · Serial Items</h2>
        <p className="meta">Scan or punch in the S.No. of any Payment Terminal, Base Station, or SIM Card.</p>
        {isFrozen && <span className="table-status">Submitted — read-only. Use “Modify Table 1” below to edit.</span>}
      </div>

      <form onSubmit={handleSubmitScan} className="filter-bar" style={{ marginTop: 12 }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={isFrozen}
          style={{ fontSize: 16 }}
          aria-label="Select the SKU before entering a serial"
        >
          <option value="">Select SKU…</option>
          {targets.map((t, i) => (
            <option key={`${t.kind}:${t.label}:${i}`} value={String(i)}>
              {targetLabel(t)}
            </option>
          ))}
        </select>
        <input
          ref={scanRef}
          type="text"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          placeholder="Scan or type a serial number"
          disabled={isFrozen || !selected}
          autoComplete="off"
          inputMode="text"
          enterKeyHint="send"
          style={{ fontSize: 16 }}
        />
        <button
          type="submit"
          title="Add this serial to the table below"
          disabled={isFrozen || busy || !selected || !scanValue.trim()}
        >
          {busy ? '…' : '+ Add'}
        </button>
        <button
          type="button"
          title="Scan the serial's 1D barcode with the camera"
          disabled={isFrozen || busy || !selected}
          onClick={() => setScanningBarcode(true)}
        >
          📷 Scan barcode
        </button>
      </form>

      {scanningBarcode && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onDetected={handleBarcodeDetected}
            onClose={() => setScanningBarcode(false)}
          />
        </Suspense>
      )}

      {/* Summary sub-table — a counts ledger, one row per SKU/model. */}
      <section className="audit-subtable audit-subtable--summary">
        <h3 className="subtable-head">Summary <span className="head-sub">counts by SKU</span></h3>
        <div className="table-wrap">
          <table className="card-table">
            <thead>
              <tr>
                <th>SKU Name</th>
                <th>Expected</th>
                <th>Matched</th>
                <th>Missing</th>
                <th>Unexpected</th>
                <th>Unregistered</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={6} className="meta">No serial-type items at this location yet. Scan a serial to add it.</td>
                </tr>
              )}
              {summary.map((s) => (
                <tr key={s.name} className="audit-serial-row" style={{ '--sku-accent': s.accent }}>
                  <td data-label="SKU Name" className="audit-sku-cell">
                    <span className="sku-dot" style={{ background: s.accent }} />
                    {s.name}
                  </td>
                  <td data-label="Expected" className="audit-count audit-count--expected">{s.expected}</td>
                  <td data-label="Matched" className={`audit-count audit-count--matched${s.matched ? '' : ' is-zero'}`}>{s.matched}</td>
                  <td data-label="Missing" className={`audit-count audit-count--missing${s.missing ? '' : ' is-zero'}`}>{s.missing}</td>
                  <td data-label="Unexpected" className={`audit-count audit-count--unexpected${s.unexpected ? '' : ' is-zero'}`}>{s.unexpected}</td>
                  <td data-label="Unregistered" className={`audit-count audit-count--unregistered${s.unregistered ? '' : ' is-zero'}`}>{s.unregistered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Serial detail sub-table — a log, one row per unit + the bucket it hit. */}
      <section className="audit-subtable audit-subtable--detail">
        <h3 className="subtable-head">Scanned items <span className="head-sub">serial detail</span></h3>
        <div className="table-wrap">
          <table className="card-table">
            <thead>
              <tr>
                <th>SKU Name</th>
                <th>Serial No.</th>
                <th>Status</th>
                <th>Working / Not Working</th>
              </tr>
            </thead>
            <tbody>
              {detail.length === 0 && (
                <tr>
                  <td colSpan={4} className="meta">No items scanned yet.</td>
                </tr>
              )}
              {detail.map(({ r, name, accent, serial, status }) => (
                <tr key={r.audit_serial_row_id} className="audit-serial-row" style={{ '--sku-accent': accent }}>
                  <td data-label="SKU Name" className="audit-sku-cell">
                    <span className="sku-dot" style={{ background: accent }} />
                    {name}
                  </td>
                  <td data-label="Serial No." className="audit-serial">{serial}</td>
                  <td data-label="Status">
                    <span className={`badge ${STATUS_BADGE[status]}`}>{status}</span>
                  </td>
                  <td data-label="Working / Not Working" className="audit-control">
                    {r.scanned_at ? (
                      <button
                        onClick={() => toggleWorking(r)}
                        disabled={isFrozen}
                        className={r.working_status === 'Working' ? 'pill active' : 'pill'}
                        title={isFrozen ? 'Re-open table to change' : 'Click to toggle'}
                      >
                        {r.working_status}
                      </button>
                    ) : <span className="meta">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rule dashed" />
      <div className="table-actions">
        <button className="primary" onClick={isFrozen ? modifyTable : submitTable}>
          {isFrozen ? 'Modify Table 1' : 'Submit Table 1'}
        </button>
      </div>
    </div>
  );
}

// ===================================================================
// Table 2 — Accessory SKUs (counter-driven)
// ===================================================================
function Table2Panel({ session, onSessionChange }) {
  const toast = useToast();
  const rows = session.table2_rows || [];
  const isFrozen = session.table2_state !== 'Editing';
  const MAX = 10000;

  const patch = async (row, field, newValue) => {
    if (isFrozen) return;
    if (newValue < 0 || newValue > MAX) return;
    if (newValue === row[field]) return;

    // Optimistic + silent: bump the count locally right away and PATCH in the
    // background without tripping the global loader. Previously each +/- awaited
    // a PATCH *and* a full-session GET, so every tap flashed the spinner.
    const applyVal = (val) => onSessionChange({
      ...session,
      auto_suspended_at: null,
      table2_rows: (session.table2_rows || []).map((r) =>
        r.audit_accessory_row_id === row.audit_accessory_row_id ? { ...r, [field]: val } : r
      ),
    });

    applyVal(newValue);
    try {
      await api.patch(
        `/audit-sessions/${session.audit_session_id}/table2/rows/${row.audit_accessory_row_id}`,
        { [field]: newValue },
        { silent: true }
      );
    } catch (e) {
      applyVal(row[field]); // revert
      toast.push(e?.data?.error || e.message || 'Update failed', 'error');
    }
  };

  const submitTable = async () => {
    try {
      const updated = await api.post(`/audit-sessions/${session.audit_session_id}/table2/submit`);
      onSessionChange(updated);
      toast.push('Table 2 submitted.', 'success');
    } catch (e) {
      toast.push(e?.data?.error || e.message || 'Submit failed', 'error');
    }
  };

  const modifyTable = async () => {
    try {
      const updated = await api.post(`/audit-sessions/${session.audit_session_id}/table2/modify`);
      onSessionChange(updated);
      toast.push('Table 2 re-opened for editing.', 'info');
    } catch (e) {
      toast.push(e?.data?.error || e.message || 'Modify failed', 'error');
    }
  };

  return (
    <div className="card">
      <div>
        <h2 style={{ marginTop: 0 }}>Table 2 (Accessories) · audit status</h2>
        <p className="meta">Increment the count against the Working / Not Working accessory.</p>
        {isFrozen && <span className="table-status">Submitted — read-only. Use “Modify Table 2” below to edit.</span>}
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="card-table">
          <thead>
            <tr>
              <th>SKU Name</th>
              <th>Expected Item Qty</th>
              <th>Working Count</th>
              <th>Not Working Count</th>
              <th>Missing Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="meta">No active accessory Vendor SKUs to audit.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.audit_accessory_row_id}>
                <td data-label="SKU Name">{r.vendor_sku_name_snapshot || ''}</td>
                <td data-label="Expected Item Qty">{r.expected_quantity}</td>
                <td data-label="Working Count" className="audit-control">
                  <Counter
                    value={r.working_count}
                    disabled={isFrozen}
                    onChange={(v) => patch(r, 'working_count', v)}
                    max={MAX}
                  />
                </td>
                <td data-label="Not Working Count" className="audit-control">
                  <Counter
                    value={r.not_working_count}
                    disabled={isFrozen}
                    onChange={(v) => patch(r, 'not_working_count', v)}
                    max={MAX}
                  />
                </td>
                <td data-label="Missing Count">{r.missing_count == null ? '' : r.missing_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rule dashed" />
      <div className="table-actions">
        <button className="primary" onClick={isFrozen ? modifyTable : submitTable}>
          {isFrozen ? 'Modify Table 2' : 'Submit Table 2'}
        </button>
      </div>
    </div>
  );
}

function Counter({ value, onChange, disabled, max = 10000 }) {
  return (
    <div className="counter">
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
        style={{ minWidth: 32, minHeight: 32 }}
        aria-label="Decrement"
      >−</button>
      <span style={{ minWidth: 32, display: 'inline-block', textAlign: 'center' }}>{value}</span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        style={{ minWidth: 32, minHeight: 32 }}
        aria-label="Increment"
      >+</button>
    </div>
  );
}
