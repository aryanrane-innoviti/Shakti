import { Router } from 'express';
import * as XLSX from 'xlsx';
import { pool, one, many, withTransaction } from '../db.js';
import { requireAuth, requireReportReader, requireReportReviewer } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';

/**
 * Phase 3 (Report slice) — Store review of ASO-authored Provisional Audit
 * Reports (PARs).
 *
 * This slice owns the PendingReview -> Completed (Approved) / Rejected
 * transition the ASO slice parked, plus the write-back of an Approved report's
 * findings into the Master tables and accessory_stock_balances.
 *
 * Roles: STU is the reviewer (cancel / row-review / submit / read / download);
 * SA + Admin are read-only oversight (list / read / download). ASO has no
 * access. Reviewer access is oversight-scoped, NOT owner-scoped — any STU may
 * review any ASO-authored PAR (see requireReportReviewer in lib/auth.js).
 *
 * API-first: every operation below is a REST endpoint; the UI is a thin client.
 * Additive only: no schema of a previously-built object is changed (migration
 * 022 adds nullable columns + widens one CHECK; nothing is dropped/retyped).
 */
const router = Router();

const REVIEWER_REMARKS_MAX = 500;

// DB status <-> UI label (task3-report.md §1.3). 'Completed' renders as
// 'Approved' (no rename — keeps every existing query/index/response intact).
const DB_TO_UI = {
  Incomplete: 'Incomplete',
  PendingReview: 'Pending',
  Completed: 'Approved',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
};
const UI_TO_DB = {
  Incomplete: 'Incomplete',
  Pending: 'PendingReview',
  Approved: 'Completed',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
};

// master_kind -> write-back target. Table/PK are from this whitelist (never
// user input), so interpolating them into SQL is safe. `recovered` is the state
// a Recovered (was-Lost) unit is restored to on Approve.
const MASTER_META = {
  payment_terminal: { table: 'payment_terminal_master', pk: 'payment_terminal_master_id', recovered: 'Working', objectType: 'PaymentTerminalMaster' },
  base_station:     { table: 'base_station_master',     pk: 'base_station_master_id',     recovered: 'Working', objectType: 'BaseStationMaster' },
  sim_card:         { table: 'sim_card_master',         pk: 'sim_card_master_id',         recovered: 'Active',  objectType: 'SIMCardMaster' },
};

const TIER = { Pending: 0, Rejected: 1, Approved: 2 };

// -------------------------------------------------------------------
// Helpers (err() mirrors auditSessions.js exactly)
// -------------------------------------------------------------------

function err(res, status, message, code, fields) {
  const body = { error: message };
  if (code) body.code = code;
  if (fields) body.fields = fields;
  return res.status(status).json(body);
}

// Effective per-row status (task3-report.md §1.4 + §1.5). The reviewer's
// explicit decision always wins; otherwise the auto rule; otherwise Pending.
// Auto-status is never persisted — computed here at read/rollup time only.
function effectiveSerialStatus(r) {
  if (r.reviewer_status) return r.reviewer_status;
  const remarksEmpty = r.remarks == null || String(r.remarks).trim() === '';
  if (r.matched === true && remarksEmpty) return 'Approved';
  return 'Pending';
}
function effectiveAccessoryStatus(r) {
  if (r.reviewer_status) return r.reviewer_status;
  if (r.missing_count != null && r.missing_count <= 0) return 'Approved';
  return 'Pending';
}

// Status-tiered sort (§6.3): Pending -> Rejected -> Approved. Within a tier the
// DB query's native order is preserved (V8 sort is stable); reviewed rows order
// by reviewed_at, auto-approved (NULL reviewed_at) sort last in their tier.
function tierSort(rows) {
  return rows.slice().sort((a, b) => {
    const t = TIER[a.effective_status] - TIER[b.effective_status];
    if (t !== 0) return t;
    const ar = a.reviewed_at ? new Date(a.reviewed_at).getTime() : Infinity;
    const br = b.reviewed_at ? new Date(b.reviewed_at).getTime() : Infinity;
    return ar - br;
  });
}

// Load one report by its AIN string. Cancelled (soft-deleted) reports are
// invisible -> 404. No owner check (oversight model); the route middleware gates
// who may call. Returns { row, status } like auditSessions.js's loader.
async function loadReportByAin(ain) {
  const row = await one(
    `SELECT s.*,
            u.first_name AS auditor_first_name, u.last_name AS auditor_last_name,
            u.email AS auditor_email,
            l.vendor_id, v.company_name AS vendor_name
       FROM audit_sessions s
       JOIN users u ON u.user_id = s.auditor_user_id
       JOIN locations l ON l.location_id = s.location_id
       LEFT JOIN vendors v ON v.vendor_id = l.vendor_id
      WHERE s.audit_index = $1 AND s.deleted_at IS NULL`,
    [ain]
  );
  if (!row) return { row: null, status: 404 };
  return { row, status: 200 };
}

async function fetchSerialRows(client, sessionId) {
  const r = await (client || pool).query(
    `SELECT * FROM audit_session_serial_rows
      WHERE audit_session_id = $1 AND deleted_at IS NULL
      ORDER BY
        CASE WHEN expected_serial_number IS NOT NULL THEN 0
             WHEN unexpected_serial_number IS NOT NULL THEN 1
             ELSE 2 END,
        scanned_at NULLS FIRST,
        audit_serial_row_id`,
    [sessionId]
  );
  return r.rows;
}

async function fetchAccessoryRows(client, sessionId) {
  const r = await (client || pool).query(
    `SELECT a.*, vs.vendor_sku_number, vs.vendor_sku_name, vs.status AS vendor_sku_status
       FROM audit_session_accessory_rows a
       JOIN vendor_skus vs ON vs.vendor_sku_id = a.vendor_sku_id
      WHERE a.audit_session_id = $1
      ORDER BY vs.vendor_sku_number`,
    [sessionId]
  );
  return r.rows;
}

// Full report detail payload (§3). The same shape serves every lifecycle state;
// the UI decides what to surface from `status` + the is_* action flags.
function shapeReport(row, serialRows, accessoryRows, session) {
  const isReviewer = session.user_type_code === 'STU';
  const serial = tierSort(serialRows.map((r) => ({ ...r, effective_status: effectiveSerialStatus(r) })));
  const accessory = tierSort(accessoryRows.map((r) => ({ ...r, effective_status: effectiveAccessoryStatus(r) })));
  return {
    audit_index: row.audit_index,
    report_type: 'aso',
    auditor: {
      user_id: row.auditor_user_id,
      user_index: row.auditor_user_index,
      first_name: row.auditor_first_name,
      last_name: row.auditor_last_name,
      email: row.auditor_email,
      role: 'ASO',
    },
    location: {
      location_id: row.location_id,
      location_name: row.location_snapshot_name,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
    },
    created_at: row.started_at,
    completed_at: row.completed_at,   // auditor pressed Complete (ASO slice)
    reviewed_at: row.reviewed_at,     // reviewer finalized (this slice); NULL until Submit
    cancelled_at: row.cancelled_at,
    status: DB_TO_UI[row.status] || row.status,
    table1: { state: row.table1_state, rows: serial },
    table2: { state: row.table2_state, rows: accessory },
    is_reviewable: (row.status === 'PendingReview' || row.status === 'Rejected') && isReviewer,
    is_cancellable: row.status === 'Incomplete' && isReviewer,
    is_downloadable: row.status === 'Completed',
  };
}

// -------------------------------------------------------------------
// Approved write-back (§1.6). Each helper runs inside the Submit transaction.
// -------------------------------------------------------------------

async function writeBackSerial(client, session, r, actor) {
  // Unregistered rows have no Master row to write into.
  if (!r.master_kind || !r.master_row_id) return;
  const meta = MASTER_META[r.master_kind];
  if (!meta) return;
  const serial = r.expected_serial_number || r.unexpected_serial_number || r.unregistered_serial_number;

  // C — missing expected unit the reviewer agreed is gone: state -> Lost,
  // last-known location preserved (present_location_id untouched).
  if (r.missing === true) {
    await client.query(
      `UPDATE ${meta.table}
          SET state = 'Lost', last_audited_at = NOW(), updated_at = NOW()
        WHERE ${meta.pk} = $1 AND deleted_at IS NULL`,
      [r.master_row_id]
    );
    await logChange(meta.objectType, serial, actor, 'Update', client);
    return;
  }

  // A — matched expected unit confirmed at the audit location. Refresh the
  // location timeline only when it actually moved.
  if (r.matched === true && r.expected_serial_number) {
    await client.query(
      `UPDATE ${meta.table}
          SET present_location_id = $1,
              present_location_since = CASE WHEN present_location_id IS DISTINCT FROM $1 THEN NOW() ELSE present_location_since END,
              last_audited_at = NOW(),
              updated_at = NOW()
        WHERE ${meta.pk} = $2 AND deleted_at IS NULL`,
      [session.location_id, r.master_row_id]
    );
    await logChange(meta.objectType, serial, actor, 'Update', client);
    return;
  }

  // B — Unexpected (in a Master, scanned here): the unit moved, so the location
  // timeline refreshes. A 'Recovered' remark (master was Lost) restores state.
  if (r.matched === true && r.unexpected_serial_number) {
    const recovered = r.remarks && /Recovered/.test(r.remarks);
    if (recovered) {
      await client.query(
        `UPDATE ${meta.table}
            SET present_location_id = $1, present_location_since = NOW(),
                last_audited_at = NOW(), state = $2, updated_at = NOW()
          WHERE ${meta.pk} = $3 AND deleted_at IS NULL`,
        [session.location_id, meta.recovered, r.master_row_id]
      );
    } else {
      await client.query(
        `UPDATE ${meta.table}
            SET present_location_id = $1, present_location_since = NOW(),
                last_audited_at = NOW(), updated_at = NOW()
          WHERE ${meta.pk} = $2 AND deleted_at IS NULL`,
        [session.location_id, r.master_row_id]
      );
    }
    await logChange(meta.objectType, serial, actor, 'Update', client);
  }
}

async function writeBackAccessory(client, session, r, actor) {
  // D — upsert the per-(vendor_sku, location) balance with this audit's counts.
  const existing = await client.query(
    `SELECT 1 FROM accessory_stock_balances WHERE vendor_sku_id = $1 AND location_id = $2`,
    [r.vendor_sku_id, session.location_id]
  );
  const action = existing.rows.length ? 'Update' : 'Create';
  await client.query(
    `INSERT INTO accessory_stock_balances
        (vendor_sku_id, location_id, working_quantity, not_working_quantity, last_audit_session_id, last_updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (vendor_sku_id, location_id) DO UPDATE
        SET working_quantity = EXCLUDED.working_quantity,
            not_working_quantity = EXCLUDED.not_working_quantity,
            last_audit_session_id = EXCLUDED.last_audit_session_id,
            last_updated_at = NOW(), updated_at = NOW()`,
    [r.vendor_sku_id, session.location_id, r.working_count, r.not_working_count, session.audit_session_id]
  );
  await logChange('AccessoryStockBalance', `${r.vendor_sku_id}:${session.location_id}`, actor, action, client);
}

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

// GET /audit-reports — list (STU / SA / Admin). Paginated; Cancelled excluded.
router.get('/', requireAuth, requireReportReader, async (req, res, next) => {
  try {
    const { status, auditor_user_id, location_id, started_at_from, started_at_to } = req.query;
    const where = ['s.deleted_at IS NULL'];
    const params = [];

    if (status !== undefined && status !== '') {
      const labels = String(status).split(',').map((x) => x.trim()).filter(Boolean);
      const bad = labels.filter((l) => !(l in UI_TO_DB));
      if (bad.length) return err(res, 422, `Unknown status filter: ${bad.join(', ')}.`, 'bad_format', { status: 'unknown label' });
      const dbVals = labels.map((l) => UI_TO_DB[l]); // Cancelled maps through but is excluded by deleted_at
      params.push(dbVals);
      where.push(`s.status = ANY($${params.length}::text[])`);
    }
    if (auditor_user_id !== undefined && auditor_user_id !== '') {
      const n = Number(auditor_user_id);
      if (!Number.isInteger(n)) return err(res, 422, `Value '${auditor_user_id}' for 'auditor_user_id' is not a valid integer.`, 'bad_format', { auditor_user_id: 'must be an integer' });
      params.push(n);
      where.push(`s.auditor_user_id = $${params.length}`);
    }
    if (location_id !== undefined && location_id !== '') {
      const n = Number(location_id);
      if (!Number.isInteger(n)) return err(res, 422, `Value '${location_id}' for 'location_id' is not a valid integer.`, 'bad_format', { location_id: 'must be an integer' });
      params.push(n);
      where.push(`s.location_id = $${params.length}`);
    }
    if (started_at_from !== undefined && started_at_from !== '') {
      if (Number.isNaN(Date.parse(started_at_from))) return err(res, 422, `Value '${started_at_from}' for 'started_at_from' is not a valid date.`, 'bad_format', { started_at_from: 'must be a date' });
      params.push(started_at_from);
      where.push(`s.started_at >= $${params.length}`);
    }
    if (started_at_to !== undefined && started_at_to !== '') {
      if (Number.isNaN(Date.parse(started_at_to))) return err(res, 422, `Value '${started_at_to}' for 'started_at_to' is not a valid date.`, 'bad_format', { started_at_to: 'must be a date' });
      params.push(started_at_to);
      where.push(`s.started_at <= $${params.length}`);
    }

    let page = Number.parseInt(req.query.page, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    let pageSize = Number.parseInt(req.query.page_size, 10);
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 25;
    if (pageSize > 100) pageSize = 100;
    const offset = (page - 1) * pageSize;

    const whereSql = where.join(' AND ');
    const totalRow = await one(`SELECT COUNT(*)::int AS n FROM audit_sessions s WHERE ${whereSql}`, params);
    const total = totalRow ? totalRow.n : 0;

    const rows = await many(
      `SELECT s.audit_session_id, s.audit_index, s.auditor_user_id, s.auditor_user_index,
              u.first_name AS auditor_first_name, u.last_name AS auditor_last_name,
              s.location_id, s.location_snapshot_name AS location_name,
              s.status, s.started_at
         FROM audit_sessions s
         JOIN users u ON u.user_id = s.auditor_user_id
        WHERE ${whereSql}
        ORDER BY s.started_at DESC, s.audit_session_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    const items = rows.map((r) => ({
      audit_index: r.audit_index,
      report_type: 'aso',
      auditor_user_id: r.auditor_user_id,
      auditor_user_index: r.auditor_user_index,
      auditor_first_name: r.auditor_first_name,
      auditor_last_name: r.auditor_last_name,
      auditor_role: 'ASO',
      location_id: r.location_id,
      location_name: r.location_name,
      created_at: r.started_at,
      status: DB_TO_UI[r.status] || r.status,
    }));

    res.json({ items, page, page_size: pageSize, total });
  } catch (e) { next(e); }
});

// GET /audit-reports/:ain — read one with full row expansion.
router.get('/:ain', requireAuth, requireReportReader, async (req, res, next) => {
  try {
    const { row } = await loadReportByAin(req.params.ain);
    if (!row) return err(res, 404, `Audit report ${req.params.ain} not found.`, 'report_not_found');
    const serial = await fetchSerialRows(null, row.audit_session_id);
    const accessory = await fetchAccessoryRows(null, row.audit_session_id);
    res.json(shapeReport(row, serial, accessory, req.session));
  } catch (e) { next(e); }
});

// POST /audit-reports/:ain/cancel — reviewer cancel of an Incomplete report.
router.post('/:ain/cancel', requireAuth, requireReportReviewer, async (req, res, next) => {
  try {
    const { row } = await loadReportByAin(req.params.ain);
    if (!row) return err(res, 404, `Audit report ${req.params.ain} not found.`, 'report_not_found');
    if (row.status !== 'Incomplete') {
      return err(res, 409, 'Only Incomplete reports can be cancelled from this screen.', 'report_not_incomplete');
    }
    await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE audit_sessions
            SET status = 'Cancelled', cancelled_at = NOW(), deleted_at = NOW(), updated_at = NOW()
          WHERE audit_session_id = $1 AND deleted_at IS NULL AND status = 'Incomplete'`,
        [row.audit_session_id]
      );
      if (upd.rowCount === 0) { const e = new Error('already_cancelled'); e.__already = true; throw e; }
      await logChange('AuditSession', row.audit_index, req.session, 'SoftDelete', client);
    });
    res.json({ audit_index: row.audit_index, status: 'Cancelled' });
  } catch (e) {
    if (e && e.__already) return err(res, 410, 'This report has already been cancelled.', 'report_already_cancelled', { audit_index: req.params.ain });
    next(e);
  }
});

// Shared per-row review handler for serial-rows and accessory-rows.
function reviewRowHandler({ table, pk, objectType, softDelete }) {
  return async (req, res, next) => {
    try {
      const { row: report } = await loadReportByAin(req.params.ain);
      if (!report) return err(res, 404, `Audit report ${req.params.ain} not found.`, 'report_not_found');
      if (!(report.status === 'PendingReview' || report.status === 'Rejected')) {
        return err(res, 409, 'This report has been finalized and cannot be modified.', 'report_frozen');
      }

      // Validate body before touching the DB.
      const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'reviewer_status');
      const hasRemarks = Object.prototype.hasOwnProperty.call(req.body || {}, 'reviewer_remarks');
      let newStatus;
      if (hasStatus) {
        const v = req.body.reviewer_status;
        if (!(v === null || v === 'Approved' || v === 'Rejected')) {
          return err(res, 422, "reviewer_status must be 'Approved', 'Rejected', or null.", 'reviewer_status_invalid', { reviewer_status: 'invalid' });
        }
        newStatus = v;
      }
      let newRemarks;
      if (hasRemarks) {
        let r = req.body.reviewer_remarks;
        if (r === null) {
          newRemarks = null;
        } else if (typeof r === 'string') {
          r = r.replace(/[\r\n]+/g, ' ').replace(/^\s+|\s+$/g, '');
          if (r.length > REVIEWER_REMARKS_MAX) {
            return err(res, 422, `reviewer_remarks may be at most ${REVIEWER_REMARKS_MAX} characters.`, 'reviewer_remarks_too_long', { reviewer_remarks: `max ${REVIEWER_REMARKS_MAX} chars` });
          }
          newRemarks = r;
        } else {
          return err(res, 422, "Value for 'reviewer_remarks' is not a valid string.", 'bad_format', { reviewer_remarks: 'must be a string' });
        }
      }

      const result = await withTransaction(async (client) => {
        // Lock the parent session so a concurrent Submit cannot freeze the
        // report out from under this write (the row lives in a different table,
        // so locking the row alone would not serialize against Submit).
        const lock = await client.query(`SELECT status FROM audit_sessions WHERE audit_session_id = $1 FOR UPDATE`, [report.audit_session_id]);
        const live = lock.rows[0] ? lock.rows[0].status : null;
        if (!(live === 'PendingReview' || live === 'Rejected')) { const e = new Error('frozen'); e.__frozen = true; throw e; }

        const sel = await client.query(
          `SELECT * FROM ${table} WHERE ${pk} = $1 AND audit_session_id = $2${softDelete ? ' AND deleted_at IS NULL' : ''}`,
          [Number(req.params.rowId), report.audit_session_id]
        );
        const target = sel.rows[0];
        if (!target) { const e = new Error('row_not_found'); e.__rowNotFound = true; throw e; }

        const sets = [];
        const params = [];
        let changed = false;
        if (hasStatus && newStatus !== target.reviewer_status) {
          params.push(newStatus); sets.push(`reviewer_status = $${params.length}`); changed = true;
        }
        if (hasRemarks && newRemarks !== target.reviewer_remarks) {
          params.push(newRemarks); sets.push(`reviewer_remarks = $${params.length}`); changed = true;
        }
        if (!changed) return { row: target, changed: false };

        // Effective change -> stamp who/when and log exactly one row.
        sets.push('reviewed_at = NOW()');
        params.push(req.session.user_id); sets.push(`reviewed_by_user_id = $${params.length}`);
        params.push(target[pk]);
        const out = await client.query(
          `UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE ${pk} = $${params.length} RETURNING *`,
          params
        );
        await logChange(objectType, target[pk], req.session, 'Update', client);
        return { row: out.rows[0], changed: true };
      });

      res.json(result.row);
    } catch (e) {
      if (e && e.__frozen) return err(res, 409, 'This report has been finalized and cannot be modified.', 'report_frozen');
      if (e && e.__rowNotFound) return err(res, 404, `Row ${req.params.rowId} does not belong to report ${req.params.ain}.`, 'report_row_not_found');
      next(e);
    }
  };
}

router.patch('/:ain/serial-rows/:rowId', requireAuth, requireReportReviewer,
  reviewRowHandler({ table: 'audit_session_serial_rows', pk: 'audit_serial_row_id', objectType: 'AuditSerialRow', softDelete: true }));

router.patch('/:ain/accessory-rows/:rowId', requireAuth, requireReportReviewer,
  reviewRowHandler({ table: 'audit_session_accessory_rows', pk: 'audit_accessory_row_id', objectType: 'AuditAccessoryRow', softDelete: false }));

// POST /audit-reports/:ain/submit — finalize to Approved or Rejected.
router.post('/:ain/submit', requireAuth, requireReportReviewer, async (req, res, next) => {
  try {
    const { row: report } = await loadReportByAin(req.params.ain);
    if (!report) return err(res, 404, `Audit report ${req.params.ain} not found.`, 'report_not_found');
    if (!(report.status === 'PendingReview' || report.status === 'Rejected')) {
      return err(res, 409, 'This report has been finalized and cannot be modified.', 'report_frozen');
    }

    await withTransaction(async (client) => {
      const lock = await client.query(`SELECT * FROM audit_sessions WHERE audit_session_id = $1 FOR UPDATE`, [report.audit_session_id]);
      const live = lock.rows[0];
      if (!live || live.deleted_at || !(live.status === 'PendingReview' || live.status === 'Rejected')) {
        const e = new Error('frozen'); e.__frozen = true; throw e;
      }

      const serialRows = (await client.query(
        `SELECT * FROM audit_session_serial_rows WHERE audit_session_id = $1 AND deleted_at IS NULL`,
        [live.audit_session_id]
      )).rows;
      const accessoryRows = (await client.query(
        `SELECT * FROM audit_session_accessory_rows WHERE audit_session_id = $1`,
        [live.audit_session_id]
      )).rows;

      const serial = serialRows.map((r) => ({ r, eff: effectiveSerialStatus(r) }));
      const accessory = accessoryRows.map((r) => ({ r, eff: effectiveAccessoryStatus(r) }));

      const pending = serial.filter((x) => x.eff === 'Pending').length + accessory.filter((x) => x.eff === 'Pending').length;
      if (pending > 0) { const e = new Error('pending'); e.__pending = pending; throw e; }

      const anyRejected = serial.some((x) => x.eff === 'Rejected') || accessory.some((x) => x.eff === 'Rejected');

      if (anyRejected) {
        // Overall Rejected — no write-back. completed_at left as the auditor time.
        await client.query(
          `UPDATE audit_sessions SET status = 'Rejected', reviewed_at = NOW(), updated_at = NOW() WHERE audit_session_id = $1`,
          [live.audit_session_id]
        );
        await logChange('AuditSession', live.audit_index, req.session, 'Update', client);
        return;
      }

      // Overall Approved — write findings back to the Masters + balances.
      for (const { r } of serial) await writeBackSerial(client, live, r, req.session);
      for (const { r } of accessory) await writeBackAccessory(client, live, r, req.session);
      await client.query(
        `UPDATE audit_sessions SET status = 'Completed', reviewed_at = NOW(), updated_at = NOW() WHERE audit_session_id = $1`,
        [live.audit_session_id]
      );
      await logChange('AuditSession', live.audit_index, req.session, 'Update', client);
    });

    const { row: fresh } = await loadReportByAin(req.params.ain);
    const serial = await fetchSerialRows(null, fresh.audit_session_id);
    const accessory = await fetchAccessoryRows(null, fresh.audit_session_id);
    res.json(shapeReport(fresh, serial, accessory, req.session));
  } catch (e) {
    if (e && e.__frozen) return err(res, 409, 'This report has been finalized and cannot be modified.', 'report_frozen');
    if (e && e.__pending) {
      return err(res, 409, `Submit requires every row to have a decision. ${e.__pending} row(s) are still pending review.`, 'report_has_pending_rows', { pending: e.__pending });
    }
    next(e);
  }
});

// GET /audit-reports/:ain/download — XLSX of an Approved report.
router.get('/:ain/download', requireAuth, requireReportReader, async (req, res, next) => {
  try {
    const { row } = await loadReportByAin(req.params.ain);
    if (!row) return err(res, 404, `Audit report ${req.params.ain} not found.`, 'report_not_found');
    if (row.status !== 'Completed') return err(res, 409, 'Only Approved reports can be downloaded.', 'report_not_approved');

    const serial = await fetchSerialRows(null, row.audit_session_id);
    const accessory = await fetchAccessoryRows(null, row.audit_session_id);
    const buf = buildReportXlsx(row, serial, accessory);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${row.audit_index}.xlsx"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// Build the downloadable workbook (zero new dependency — reuses the `xlsx` lib
// already used by routes/loads.js). Header + Table 1 + Table 2 sheets, each row
// carrying both the auditor's and the reviewer's remarks/status.
function buildReportXlsx(row, serialRows, accessoryRows) {
  const fmt = (d) => (d ? new Date(d).toISOString() : '');
  const wb = XLSX.utils.book_new();

  const header = [
    ['Audit Report', row.audit_index],
    ['Report Type', 'ASO'],
    ['Auditor', `${row.auditor_first_name || ''} ${row.auditor_last_name || ''}`.trim()],
    ['Auditor ID', row.auditor_user_index],
    ['Location', row.location_snapshot_name],
    ['Vendor', row.vendor_name || ''],
    ['Created At', fmt(row.started_at)],
    ['Auditor Completed At', fmt(row.completed_at)],
    ['Reviewed At', fmt(row.reviewed_at)],
    ['Final Status', DB_TO_UI[row.status] || row.status],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(header), 'Summary');

  const t1Header = ['SKU Number', 'SKU Name', 'Expected S.No.', 'Unexpected S.No.', 'Unregistered S.No.',
    'Matched', 'Missing', 'Working Status', 'Auditor Remarks', 'Effective Status', 'Reviewer Status', 'Reviewer Remarks'];
  const t1 = serialRows.map((r) => [
    r.vendor_sku_number_snapshot || r.sku_number_snapshot || '',
    r.vendor_sku_name_snapshot || r.sku_name_snapshot || '',
    r.expected_serial_number || '', r.unexpected_serial_number || '', r.unregistered_serial_number || '',
    r.matched ? 'Yes' : 'No', r.missing ? 'Yes' : 'No', r.working_status || '',
    r.remarks || '', effectiveSerialStatus(r), r.reviewer_status || '', r.reviewer_remarks || '',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t1Header, ...t1]), 'Table 1 - Serial');

  const t2Header = ['Vendor SKU Number', 'Vendor SKU Name', 'Expected Qty', 'Working', 'Not Working',
    'Missing', 'Effective Status', 'Reviewer Status', 'Reviewer Remarks'];
  const t2 = accessoryRows.map((r) => [
    r.vendor_sku_number || r.vendor_sku_number_snapshot || '',
    r.vendor_sku_name || r.vendor_sku_name_snapshot || '',
    r.expected_quantity, r.working_count, r.not_working_count, r.missing_count == null ? '' : r.missing_count,
    effectiveAccessoryStatus(r), r.reviewer_status || '', r.reviewer_remarks || '',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t2Header, ...t2]), 'Table 2 - Accessory');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export default router;
