import { Router } from 'express';
import { pool, one, many, withTransaction } from '../db.js';
import { requireAuth, requireAdminRead, requireAso } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { ValidationError, required } from '../lib/validate.js';

/**
 * Phase 3 ASO Audit Session routes.
 *
 * Owned by ASO. SA / Admin get read-only oversight on list + get-one.
 * Lifecycle: Incomplete -> PendingReview (Complete) | Cancelled (Cancel).
 * Completed is reserved for the Store-review slice.
 *
 * State invariants:
 *   - One non-terminal session per ASO (enforced by partial unique index).
 *   - PendingReview / Cancelled sessions are frozen against any mutation here.
 *   - Table 1 / Table 2 each have their own Editing <-> Submitted flip.
 *   - Complete requires BOTH tables Submitted.
 */
const router = Router();

const ROW_LIMIT_PER_COUNTER = 10000;

// Master states that mean "expected at this location" for Table 1 seeding.
// We exclude terminal states (Scrap/Loss) — Lost serials enter Table 1
// only via the "Recovered" remark path during a scan.
const EXPECTED_PT_BS_STATES = ['Working', 'Retrieved Not Inspected', 'Installed', 'Under Repair', 'Repaired Not Inspected', 'In Transit'];
const EXPECTED_SIM_STATES = ['Active', 'Inactive', 'Blocked'];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function err(res, status, message, code, fields) {
  const body = { error: message };
  if (code) body.code = code;
  if (fields) body.fields = fields;
  return res.status(status).json(body);
}

async function loadSessionForActor(sessionId, session, { allowReaders = false } = {}) {
  const row = await one(
    `SELECT s.*, u.first_name AS auditor_first_name, u.last_name AS auditor_last_name,
            l.location_name AS current_location_name,
            l.location_index AS current_location_index
       FROM audit_sessions s
       JOIN users u ON u.user_id = s.auditor_user_id
       JOIN locations l ON l.location_id = s.location_id
      WHERE s.audit_session_id = $1`,
    [Number(sessionId)]
  );
  if (!row) return { row: null, status: 404 };
  const isAdmin = session.user_type_code === 'SA' || session.user_type_code === 'ADMIN';
  const isOwner = row.auditor_user_id === session.user_id;
  if (!isOwner && !(allowReaders && isAdmin)) {
    return { row: null, status: 403 };
  }
  return { row, status: 200 };
}

async function loadCurrentNonTerminal(userId) {
  return one(
    `SELECT audit_session_id, audit_index, status
       FROM audit_sessions
      WHERE auditor_user_id = $1
        AND status IN ('Incomplete','PendingReview')
        AND deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
}

async function fetchTable1Rows(client, sessionId) {
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

async function fetchTable2Rows(client, sessionId) {
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

function shapeSession(row, table1, table2) {
  return {
    audit_session_id: row.audit_session_id,
    audit_index: row.audit_index,
    auditor_user_id: row.auditor_user_id,
    auditor_user_index: row.auditor_user_index,
    auditor_name: `${row.auditor_first_name} ${row.auditor_last_name}`.trim(),
    location_id: row.location_id,
    location_snapshot_name: row.location_snapshot_name,
    status: row.status,
    table1_state: row.table1_state,
    table2_state: row.table2_state,
    started_at: row.started_at,
    last_activity_at: row.last_activity_at,
    auto_suspended_at: row.auto_suspended_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    table1_rows: table1,
    table2_rows: table2,
  };
}

async function bumpActivity(client, sessionId) {
  await client.query(
    `UPDATE audit_sessions
        SET last_activity_at = NOW(),
            auto_suspended_at = NULL,
            updated_at = NOW()
      WHERE audit_session_id = $1`,
    [sessionId]
  );
}

// -------------------------------------------------------------------
// Seeding (runs inside the session-create transaction)
// -------------------------------------------------------------------

async function seedTable1(client, sessionId, locationId) {
  // Payment Terminals at this location, in an expected state, owned by an Active
  // Vendor SKU. Keyed on the unit's OWN m.vendor_sku_id (not the Innoviti SKU's
  // default-supplier link) so the seeded vendor_sku_id_snapshot is the exact key
  // the ASO selects + the scan matcher searches on — see resolveScanTarget /
  // findInMasterForTarget. sku_id is nullable on PT/BS since migration 009, so
  // the SKU join is LEFT (a unit without a resolved Innoviti SKU still seeds).
  await client.query(
    `INSERT INTO audit_session_serial_rows (
        audit_session_id, master_kind, master_row_id,
        vendor_sku_id_snapshot, vendor_sku_number_snapshot, vendor_sku_name_snapshot,
        sku_id_snapshot, sku_number_snapshot, sku_name_snapshot,
        expected_serial_number)
      SELECT $1, 'payment_terminal', m.payment_terminal_master_id,
             vs.vendor_sku_id, vs.vendor_sku_number, vs.vendor_sku_name,
             s.sku_id, s.sku_number, s.sku_name,
             m.serial_number
        FROM payment_terminal_master m
        JOIN vendor_skus vs
          ON vs.vendor_sku_id = m.vendor_sku_id AND vs.deleted_at IS NULL AND vs.status = 'Active'
        LEFT JOIN skus s ON s.sku_id = m.sku_id
       WHERE m.present_location_id = $2
         AND m.deleted_at IS NULL
         AND m.state = ANY($3::text[])`,
    [sessionId, locationId, EXPECTED_PT_BS_STATES]
  );

  // Base Stations at this location (same vendor-SKU-keyed logic as PT).
  await client.query(
    `INSERT INTO audit_session_serial_rows (
        audit_session_id, master_kind, master_row_id,
        vendor_sku_id_snapshot, vendor_sku_number_snapshot, vendor_sku_name_snapshot,
        sku_id_snapshot, sku_number_snapshot, sku_name_snapshot,
        expected_serial_number)
      SELECT $1, 'base_station', m.base_station_master_id,
             vs.vendor_sku_id, vs.vendor_sku_number, vs.vendor_sku_name,
             s.sku_id, s.sku_number, s.sku_name,
             m.serial_number
        FROM base_station_master m
        JOIN vendor_skus vs
          ON vs.vendor_sku_id = m.vendor_sku_id AND vs.deleted_at IS NULL AND vs.status = 'Active'
        LEFT JOIN skus s ON s.sku_id = m.sku_id
       WHERE m.present_location_id = $2
         AND m.deleted_at IS NULL
         AND m.state = ANY($3::text[])`,
    [sessionId, locationId, EXPECTED_PT_BS_STATES]
  );

  // SIM Cards at this location. SIMs have no Vendor SKU column on the master;
  // gate by the Innoviti SKU's status instead.
  await client.query(
    `INSERT INTO audit_session_serial_rows (
        audit_session_id, master_kind, master_row_id,
        sku_id_snapshot, sku_number_snapshot, sku_name_snapshot,
        expected_serial_number)
      SELECT $1, 'sim_card', m.sim_card_master_id,
             s.sku_id, s.sku_number, s.sku_name,
             m.sim_card_number
        FROM sim_card_master m
        JOIN skus s ON s.sku_id = m.sku_id AND s.status = 'Active' AND s.deleted_at IS NULL
       WHERE m.present_location_id = $2
         AND m.deleted_at IS NULL
         AND m.state = ANY($3::text[])`,
    [sessionId, locationId, EXPECTED_SIM_STATES]
  );
}

async function seedTable2(client, sessionId, locationId) {
  // Every accessory (serial_eligible = false) Vendor SKU is auditable, from ANY
  // vendor and whether Active or Inactive — only soft-deleted ones are skipped.
  // (Product decision: the original Innoviti-vendor + Active-only gate was too
  // narrow; a cable from a third-party vendor must still appear in Table 2.)
  // Expected qty is drawn from accessory_stock_balances (defaults to 0 when no
  // row exists for this location).
  await client.query(
    `INSERT INTO audit_session_accessory_rows (
        audit_session_id, vendor_sku_id,
        vendor_sku_number_snapshot, vendor_sku_name_snapshot,
        expected_quantity)
      SELECT $1, vs.vendor_sku_id,
             vs.vendor_sku_number, vs.vendor_sku_name,
             COALESCE(asb.working_quantity, 0) + COALESCE(asb.not_working_quantity, 0)
        FROM vendor_skus vs
        JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
        LEFT JOIN accessory_stock_balances asb
          ON asb.vendor_sku_id = vs.vendor_sku_id AND asb.location_id = $2
       WHERE vs.deleted_at IS NULL
         AND st.serial_eligible = FALSE
       ORDER BY vs.vendor_sku_number`,
    [sessionId, locationId]
  );
}

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

// POST /audit-sessions — start (or resume) the calling ASO's session.
router.post('/', requireAuth, requireAso, async (req, res, next) => {
  try {
    const me = req.session;

    // Resume existing Incomplete session if present.
    const existing = await loadCurrentNonTerminal(me.user_id);
    if (existing) {
      if (existing.status === 'PendingReview') {
        return err(
          res, 409,
          `Previous audit ${existing.audit_index} is awaiting Store review. Cannot start a new audit by the same user until the previous audit review is closed.`,
          'audit_pending_review_block',
          { audit_index: existing.audit_index }
        );
      }
      // Incomplete → return existing (resume).
      const { row } = await loadSessionForActor(existing.audit_session_id, me);
      const t1 = await fetchTable1Rows(null, row.audit_session_id);
      const t2 = await fetchTable2Rows(null, row.audit_session_id);
      return res.status(200).json(shapeSession(row, t1, t2));
    }

    // The ASO's audit location is users.location_id (task1.md §3); assignment
    // happens on the User form (POST/PATCH /users). Snapshot it into the session.
    const loc = await one(
      `SELECT l.location_id, l.location_name
         FROM users u
         JOIN locations l ON l.location_id = u.location_id AND l.deleted_at IS NULL
        WHERE u.user_id = $1`,
      [me.user_id]
    );
    if (!loc) {
      return err(
        res, 422,
        'You do not have an audit location assigned. Ask an Admin to set your location on your user profile before starting an audit.',
        'audit_location_not_assigned'
      );
    }

    let sessionRow;
    try {
      sessionRow = await withTransaction(async (client) => {
        const audit_index = await nextIndex('audit', client);
        const ins = await client.query(
          `INSERT INTO audit_sessions (
             audit_index, auditor_user_id, auditor_user_index,
             location_id, location_snapshot_name)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [audit_index, me.user_id, me.user_index, loc.location_id, loc.location_name]
        );
        const created = ins.rows[0];
        await seedTable1(client, created.audit_session_id, loc.location_id);
        await seedTable2(client, created.audit_session_id, loc.location_id);
        await logChange('AuditSession', audit_index, me, 'Create', client);
        return created;
      });
    } catch (e) {
      // Partial-unique-index race: another request created the open session.
      // Re-read and return the resume path.
      if (e && e.code === '23505') {
        const again = await loadCurrentNonTerminal(me.user_id);
        if (again) {
          const { row } = await loadSessionForActor(again.audit_session_id, me);
          const t1 = await fetchTable1Rows(null, row.audit_session_id);
          const t2 = await fetchTable2Rows(null, row.audit_session_id);
          return res.status(200).json(shapeSession(row, t1, t2));
        }
      }
      throw e;
    }

    const { row } = await loadSessionForActor(sessionRow.audit_session_id, me);
    const t1 = await fetchTable1Rows(null, row.audit_session_id);
    const t2 = await fetchTable2Rows(null, row.audit_session_id);
    res.status(201).json(shapeSession(row, t1, t2));
  } catch (e) { next(e); }
});

// GET /audit-sessions/current — ASO's current session in minimal-or-full form.
router.get('/current', requireAuth, requireAso, async (req, res, next) => {
  try {
    const me = req.session;
    const current = await loadCurrentNonTerminal(me.user_id);
    if (!current) return res.json({ status: 'none' });
    if (current.status === 'PendingReview') {
      return res.json({ status: 'PendingReview', audit_index: current.audit_index, audit_session_id: current.audit_session_id });
    }
    const { row } = await loadSessionForActor(current.audit_session_id, me);
    const t1 = await fetchTable1Rows(null, row.audit_session_id);
    const t2 = await fetchTable2Rows(null, row.audit_session_id);
    res.json(shapeSession(row, t1, t2));
  } catch (e) { next(e); }
});

// GET /audit-sessions — list (SA / Admin only).
router.get('/', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    // ASO must NEVER hit this list endpoint — they use /current.
    if (req.session.user_type_code === 'ASO') return res.status(403).json({ error: 'forbidden' });

    const { status, auditor_user_id, location_id, started_at_from, started_at_to } = req.query;
    const where = ['s.deleted_at IS NULL'];
    const params = [];
    if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
    if (auditor_user_id) { params.push(Number(auditor_user_id)); where.push(`s.auditor_user_id = $${params.length}`); }
    if (location_id) { params.push(Number(location_id)); where.push(`s.location_id = $${params.length}`); }
    if (started_at_from) { params.push(started_at_from); where.push(`s.started_at >= $${params.length}`); }
    if (started_at_to) { params.push(started_at_to); where.push(`s.started_at <= $${params.length}`); }
    const rows = await many(
      `SELECT s.audit_session_id, s.audit_index, s.auditor_user_id, s.auditor_user_index,
              u.first_name || ' ' || u.last_name AS auditor_name,
              s.location_id, s.location_snapshot_name,
              s.status, s.table1_state, s.table2_state,
              s.started_at, s.last_activity_at, s.auto_suspended_at,
              s.completed_at, s.cancelled_at
         FROM audit_sessions s
         JOIN users u ON u.user_id = s.auditor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.started_at DESC`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /audit-sessions/:id — read one (SA / Admin / session owner).
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session, { allowReaders: true });
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    const t1 = await fetchTable1Rows(null, row.audit_session_id);
    const t2 = await fetchTable2Rows(null, row.audit_session_id);
    res.json(shapeSession(row, t1, t2));
  } catch (e) { next(e); }
});

// POST /audit-sessions/:id/cancel — soft-delete, sets Cancelled.
router.post('/:id/cancel', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') {
      // Idempotent.
      return res.json(shapeSession(row, await fetchTable1Rows(null, row.audit_session_id), await fetchTable2Rows(null, row.audit_session_id)));
    }
    if (row.status === 'PendingReview' || row.status === 'Completed') {
      return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_sessions
            SET status = 'Cancelled',
                cancelled_at = NOW(),
                deleted_at = NOW(),
                updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'SoftDelete', client);
    });
    const fresh = await one(`SELECT * FROM audit_sessions WHERE audit_session_id = $1`, [row.audit_session_id]);
    res.json({ ...row, ...fresh });
  } catch (e) { next(e); }
});

// POST /audit-sessions/:id/complete — transition Incomplete -> PendingReview.
router.post('/:id/complete', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');

    const pending = [];
    if (row.table1_state !== 'Submitted') pending.push('Table 1');
    if (row.table2_state !== 'Submitted') pending.push('Table 2');
    if (pending.length) {
      return err(
        res, 409,
        `Both Table 1 and Table 2 must be submitted before completing the audit. Pending: ${pending.join(', ')}.`,
        'audit_tables_not_submitted',
        { pending }
      );
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_sessions
            SET status = 'PendingReview',
                completed_at = NOW(),
                last_activity_at = NOW(),
                auto_suspended_at = NULL,
                updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'Update', client);
    });

    const { row: fresh } = await loadSessionForActor(row.audit_session_id, req.session);
    const t1 = await fetchTable1Rows(null, fresh.audit_session_id);
    const t2 = await fetchTable2Rows(null, fresh.audit_session_id);
    res.json(shapeSession(fresh, t1, t2));
  } catch (e) { next(e); }
});

// ===================================================================
// Table 1 — scan, row PATCH, submit, modify
// ===================================================================

// A scanned serial is unique only WITHIN a Vendor SKU (migration 009:
// UNIQUE(vendor_sku_id, serial_number) on PT/BS), so a bare serial is ambiguous
// and the ASO must pick a SKU first. But the ASO should NOT have to know which
// *vendor* supplies a given model — they see a device labelled, say, "MOV 2500"
// and scan it. So the picker groups Vendor SKUs by display name: one "MOV 2500"
// entry even when two vendors each carry a Vendor SKU of that name. The selection
// resolves to the SET of vendor_sku_ids sharing that name; the scanned serial is
// matched across that set and the Master row that's hit tells us which vendor's
// unit it actually is (recovered into the snapshot). SIMs carry no Vendor SKU,
// so they are picked by their Innoviti SKU (already one entry per model).
//
// resolveScanTarget validates the {vendor_sku_ids[] | sku_id} the client sent and
// returns a normalized target: match_col + match_vals (the keys to scope every
// match by) plus the snapshot columns to write.
async function resolveScanTarget(client, body) {
  const rawIds = body && body.vendor_sku_ids;
  const hasV = Array.isArray(rawIds) && rawIds.length > 0;
  const hasS = body && body.sku_id !== undefined && body.sku_id !== null && body.sku_id !== '';
  if (hasV === hasS) {
    return { error: {
      code: 'required_missing',
      message: 'Select a SKU before entering a serial number.',
      fields: { vendor_sku_ids: 'exactly one of vendor_sku_ids / sku_id is required' },
    } };
  }

  if (hasV) {
    const ids = [...new Set(rawIds.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) {
      return { error: { code: 'bad_format', message: 'Selected SKU group is empty or invalid.', fields: { vendor_sku_ids: 'invalid' } } };
    }
    const r = await client.query(
      `SELECT vs.vendor_sku_id, vs.vendor_sku_number, vs.vendor_sku_name, st.name AS type_name
         FROM vendor_skus vs
         JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
        WHERE vs.vendor_sku_id = ANY($1::int[]) AND vs.deleted_at IS NULL AND vs.status = 'Active'
          AND st.serial_eligible = TRUE AND st.name <> 'SIM Card'
        ORDER BY vs.vendor_sku_id`,
      [ids]
    );
    if (!r.rows.length) {
      return { error: { code: 'bad_format', message: 'Selected SKU is not a valid active serial-type Vendor SKU.', fields: { vendor_sku_ids: 'invalid' } } };
    }
    // Every Vendor SKU in a name-group is the same physical type, so the master
    // kind is consistent; derive it from the first row. The representative
    // Vendor SKU anchors an Unregistered scan (serial in no Master of the group).
    const rep = r.rows[0];
    const groupName = (rep.vendor_sku_name && rep.vendor_sku_name.trim()) || rep.vendor_sku_number;
    return { target: {
      kind: 'vendor_sku_group',
      match_col: 'vendor_sku_id_snapshot',
      match_vals: r.rows.map((x) => x.vendor_sku_id),
      master_kind: rep.type_name === 'Base Station' ? 'base_station' : 'payment_terminal',
      rep_vendor_sku_id: rep.vendor_sku_id,
      rep_vendor_sku_number: rep.vendor_sku_number,
      rep_vendor_sku_name: groupName,
    } };
  }

  // SIM: identified by its Innoviti SKU (SIM Master carries no vendor_sku_id).
  const r = await client.query(
    `SELECT s.sku_id, s.sku_number, s.sku_name
       FROM skus s
       JOIN sku_types st ON st.sku_type_id = s.sku_type_id
      WHERE s.sku_id = $1 AND s.deleted_at IS NULL AND s.status = 'Active'
        AND st.name = 'SIM Card'`,
    [Number(body.sku_id)]
  );
  if (!r.rows.length) {
    return { error: { code: 'bad_format', message: 'Selected SIM SKU is not a valid active SIM SKU.', fields: { sku_id: 'invalid' } } };
  }
  const s = r.rows[0];
  return { target: {
    kind: 'sim',
    match_col: 'sku_id_snapshot',
    match_vals: [s.sku_id],
    master_kind: 'sim_card',
    sku_id: s.sku_id, sku_number: s.sku_number, sku_name: s.sku_name,
  } };
}

// Search the Master for a row whose serial matches, scoped to the target. For a
// Vendor-SKU name-group this spans every vendor_sku_id in the group, so the row
// that's found reveals the ACTUAL vendor of the scanned unit (recovered into the
// snapshot). Returns { row, multi } or null; `multi` flags the rare data-quality
// case where the same serial lives under more than one Vendor SKU of the group.
async function findInMasterForTarget(client, target, serial) {
  if (target.kind === 'vendor_sku_group') {
    const table = target.master_kind === 'base_station' ? 'base_station_master' : 'payment_terminal_master';
    const idCol = target.master_kind === 'base_station' ? 'base_station_master_id' : 'payment_terminal_master_id';
    const r = await client.query(
      `SELECT m.${idCol} AS master_row_id, m.vendor_sku_id, m.sku_id,
              m.present_location_id, m.state,
              vs.vendor_sku_number, vs.vendor_sku_name,
              s.sku_number, s.sku_name
         FROM ${table} m
         JOIN vendor_skus vs ON vs.vendor_sku_id = m.vendor_sku_id
         LEFT JOIN skus s ON s.sku_id = m.sku_id
        WHERE m.vendor_sku_id = ANY($1::int[]) AND m.serial_number = $2 AND m.deleted_at IS NULL
        ORDER BY m.${idCol}
        LIMIT 2`,
      [target.match_vals, serial]
    );
    if (!r.rows.length) return null;
    return { row: r.rows[0], multi: r.rows.length > 1 };
  }
  const r = await client.query(
    `SELECT m.sim_card_master_id AS master_row_id, m.sku_id, m.present_location_id, m.state,
            s.sku_number, s.sku_name
       FROM sim_card_master m
       LEFT JOIN skus s ON s.sku_id = m.sku_id
      WHERE m.sku_id = $1 AND m.sim_card_number = $2 AND m.deleted_at IS NULL
      LIMIT 1`,
    [target.sku_id, serial]
  );
  if (!r.rows.length) return null;
  return { row: r.rows[0], multi: false };
}

// GET /audit-sessions/:id/table1/scan-targets — the SKU picker the ASO chooses
// from before entering a serial. Vendor SKUs are grouped by display name so a
// model carried by two vendors shows once (vendor-agnostic — the Master recovers
// the actual vendor on scan); SIM SKUs are listed by their Innoviti SKU. Spans
// every active serial-type SKU so Unexpected / Unregistered scans for any model
// are recordable, not just the ones expected at this location.
router.get('/:id/table1/scan-targets', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });

    const groups = await many(
      `SELECT COALESCE(NULLIF(TRIM(vs.vendor_sku_name), ''), vs.vendor_sku_number) AS label,
              st.name AS type_name,
              array_agg(vs.vendor_sku_id ORDER BY vs.vendor_sku_id) AS vendor_sku_ids
         FROM vendor_skus vs
         JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
        WHERE vs.status = 'Active' AND vs.deleted_at IS NULL
          AND st.serial_eligible = TRUE AND st.name <> 'SIM Card'
        GROUP BY label, st.name
        ORDER BY label`
    );
    const simSkus = await many(
      `SELECT s.sku_id, COALESCE(NULLIF(TRIM(s.sku_name), ''), s.sku_number) AS label,
              st.name AS type_name
         FROM skus s
         JOIN sku_types st ON st.sku_type_id = s.sku_type_id
        WHERE s.status = 'Active' AND s.deleted_at IS NULL
          AND st.name = 'SIM Card'
        ORDER BY label`
    );

    const targets = [
      ...groups.map((r) => ({ kind: 'vendor_sku', label: r.label, type_name: r.type_name, vendor_sku_ids: r.vendor_sku_ids })),
      ...simSkus.map((r) => ({ kind: 'sim_sku', label: r.label, type_name: r.type_name, sku_id: r.sku_id })),
    ];
    res.json({ targets });
  } catch (e) { next(e); }
});

router.post('/:id/table1/scan', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table1_state !== 'Editing') {
      return err(res, 409, 'Table 1 has been submitted. Press Modify to re-open it before changing scans.', 'table1_frozen');
    }

    const raw = req.body && req.body.serial_number;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return err(res, 422, "Required field 'serial_number' missing.", 'required_missing', { serial_number: 'required' });
    }
    const serial = raw.trim().replace(/\s+/g, ' ');
    if (serial.length > 100) {
      return err(res, 422, `Value '${serial}' for 'serial_number' is not a valid string (≤100 chars).`, 'bad_format', { serial_number: 'must be ≤100 chars' });
    }

    const resultRow = await withTransaction(async (client) => {
      const resolved = await resolveScanTarget(client, req.body);
      if (resolved.error) {
        const e = new Error('bad_target');
        e.__target = resolved.error;
        throw e;
      }
      const target = resolved.target;

      // 1) Duplicate guard — same serial already counted for THIS model in
      // this session. Scoping by the model's key set is what lets the same
      // serial be recorded once per model that legitimately shares it.
      const dup = await client.query(
        `SELECT audit_serial_row_id
           FROM audit_session_serial_rows
          WHERE audit_session_id = $1
            AND deleted_at IS NULL
            AND ${target.match_col} = ANY($3::int[])
            AND (
              (expected_serial_number = $2 AND matched = TRUE) OR
              unexpected_serial_number = $2 OR
              unregistered_serial_number = $2
            )
          LIMIT 1`,
        [row.audit_session_id, serial, target.match_vals]
      );
      if (dup.rows.length) {
        const e = new Error('duplicate_scan');
        e.__duplicate = true;
        e.__serial = serial;
        throw e;
      }

      // 2) Expected match — flip one unmatched expected row for this model
      // whose serial equals the scan.
      const expectedHit = await client.query(
        `UPDATE audit_session_serial_rows
            SET matched = TRUE, scanned_at = NOW(), updated_at = NOW()
          WHERE audit_serial_row_id = (
            SELECT audit_serial_row_id FROM audit_session_serial_rows
             WHERE audit_session_id = $1 AND expected_serial_number = $2
               AND ${target.match_col} = ANY($3::int[])
               AND matched = FALSE AND deleted_at IS NULL
             ORDER BY audit_serial_row_id LIMIT 1
          )
          RETURNING *`,
        [row.audit_session_id, serial, target.match_vals]
      );
      if (expectedHit.rows.length) {
        await logChange('AuditSerialRow', expectedHit.rows[0].audit_serial_row_id, req.session, 'Update', client);
        await bumpActivity(client, row.audit_session_id);
        return expectedHit.rows[0];
      }

      // 3) Master search scoped to the model. An in-Master serial not on the
      // expected list becomes an Unexpected row. For a Vendor-SKU group the
      // matched Master row reveals the ACTUAL vendor, which we snapshot.
      const found = await findInMasterForTarget(client, target, serial);
      if (found) {
        const hit = found.row;
        const isSim = target.kind === 'sim';
        const remarks = [];
        if (hit.present_location_id && hit.present_location_id !== row.location_id) remarks.push('Wrong Location');
        if (hit.state === 'Lost') remarks.push('Recovered');
        if (found.multi) remarks.push('Multiple master matches; first used.');
        const remarksText = remarks.length ? remarks.join(', ') : null;
        const ins = await client.query(
          `INSERT INTO audit_session_serial_rows (
              audit_session_id, master_kind, master_row_id,
              vendor_sku_id_snapshot, vendor_sku_number_snapshot, vendor_sku_name_snapshot,
              sku_id_snapshot, sku_number_snapshot, sku_name_snapshot,
              unexpected_serial_number, matched, scanned_at, remarks)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW(), $11)
           RETURNING *`,
          [
            row.audit_session_id, target.master_kind, hit.master_row_id,
            isSim ? null : hit.vendor_sku_id,
            isSim ? null : hit.vendor_sku_number,
            isSim ? null : hit.vendor_sku_name,
            isSim ? target.sku_id : hit.sku_id,
            isSim ? target.sku_number : hit.sku_number,
            isSim ? target.sku_name : hit.sku_name,
            serial, remarksText,
          ]
        );
        await logChange('AuditSerialRow', ins.rows[0].audit_serial_row_id, req.session, 'Create', client);
        await bumpActivity(client, row.audit_session_id);
        return ins.rows[0];
      }

      // 4) Unregistered — serial in no Master of this model. The chosen model is
      // still snapshotted (vendor-agnostic: a representative Vendor SKU of the
      // name-group, or the SIM SKU) so the row shows which model the ASO claimed.
      // matched stays FALSE: "Matched" means the serial was found in the Master,
      // which by definition an Unregistered serial was not. The serial lands in
      // the unregistered_serial_number column instead.
      const isSim = target.kind === 'sim';
      const ins = await client.query(
        `INSERT INTO audit_session_serial_rows (
            audit_session_id, master_kind,
            vendor_sku_id_snapshot, vendor_sku_number_snapshot, vendor_sku_name_snapshot,
            sku_id_snapshot, sku_number_snapshot, sku_name_snapshot,
            unregistered_serial_number, matched, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
         RETURNING *`,
        [
          row.audit_session_id, target.master_kind,
          isSim ? null : target.rep_vendor_sku_id,
          isSim ? null : target.rep_vendor_sku_number,
          isSim ? null : target.rep_vendor_sku_name,
          isSim ? target.sku_id : null,
          isSim ? target.sku_number : null,
          isSim ? target.sku_name : null,
          serial,
        ]
      );
      await logChange('AuditSerialRow', ins.rows[0].audit_serial_row_id, req.session, 'Create', client);
      await bumpActivity(client, row.audit_session_id);
      return ins.rows[0];
    });

    res.json(resultRow);
  } catch (e) {
    if (e && e.__duplicate) {
      return err(res, 409, `${e.__serial} has already been audited in this session.`, 'duplicate_scan', { serial_number: e.__serial });
    }
    if (e && e.__target) {
      return err(res, 422, e.__target.message, e.__target.code, e.__target.fields);
    }
    next(e);
  }
});

router.patch('/:id/table1/rows/:rowId', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table1_state !== 'Editing') return err(res, 409, 'Table 1 has been submitted. Press Modify to re-open it before changing scans.', 'table1_frozen');

    const target = await one(
      `SELECT * FROM audit_session_serial_rows
        WHERE audit_serial_row_id = $1 AND audit_session_id = $2 AND deleted_at IS NULL`,
      [Number(req.params.rowId), row.audit_session_id]
    );
    if (!target) return res.status(404).json({ error: 'not_found' });

    const updates = [];
    const params = [];
    let hasChange = false;

    if (req.body.working_status !== undefined) {
      const ws = req.body.working_status;
      if (ws !== 'Working' && ws !== 'Not Working') {
        return err(res, 422, `Value '${ws}' for 'working_status' is not a valid Working|Not Working.`, 'bad_format', { working_status: "must be 'Working' or 'Not Working'" });
      }
      if (ws !== target.working_status) {
        params.push(ws);
        updates.push(`working_status = $${params.length}`);
        hasChange = true;
      }
    }

    if (req.body.remarks !== undefined) {
      let r = req.body.remarks;
      if (r === null) {
        if (target.remarks !== null) {
          updates.push(`remarks = NULL`);
          hasChange = true;
        }
      } else {
        if (typeof r !== 'string') {
          return err(res, 422, `Value for 'remarks' is not a valid string.`, 'bad_format', { remarks: 'must be a string' });
        }
        r = r.replace(/[\r\n]+/g, ' ').replace(/^\s+/, '');
        if (r.length > 500) {
          return err(res, 422, `Value for 'remarks' is too long (max 500 chars).`, 'bad_format', { remarks: 'max 500 chars' });
        }
        if (r !== target.remarks) {
          params.push(r);
          updates.push(`remarks = $${params.length}`);
          hasChange = true;
        }
      }
    }

    if (!hasChange) {
      // No-op: no change-log row.
      return res.json(target);
    }

    params.push(target.audit_serial_row_id);
    const updatedRow = await withTransaction(async (client) => {
      const out = await client.query(
        `UPDATE audit_session_serial_rows
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE audit_serial_row_id = $${params.length}
          RETURNING *`,
        params
      );
      await logChange('AuditSerialRow', target.audit_serial_row_id, req.session, 'Update', client);
      await bumpActivity(client, row.audit_session_id);
      return out.rows[0];
    });
    res.json(updatedRow);
  } catch (e) { next(e); }
});

router.post('/:id/table1/submit', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table1_state === 'Submitted') {
      // Idempotent — already submitted.
      const t1 = await fetchTable1Rows(null, row.audit_session_id);
      const t2 = await fetchTable2Rows(null, row.audit_session_id);
      return res.json(shapeSession(row, t1, t2));
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_session_serial_rows
            SET missing = TRUE, updated_at = NOW()
          WHERE audit_session_id = $1
            AND expected_serial_number IS NOT NULL
            AND matched = FALSE
            AND deleted_at IS NULL`,
        [row.audit_session_id]
      );
      await client.query(
        `UPDATE audit_sessions
            SET table1_state = 'Submitted', last_activity_at = NOW(),
                auto_suspended_at = NULL, updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'Update', client);
    });
    const { row: fresh } = await loadSessionForActor(row.audit_session_id, req.session);
    res.json(shapeSession(fresh, await fetchTable1Rows(null, row.audit_session_id), await fetchTable2Rows(null, row.audit_session_id)));
  } catch (e) { next(e); }
});

router.post('/:id/table1/modify', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table1_state === 'Editing') {
      const t1 = await fetchTable1Rows(null, row.audit_session_id);
      const t2 = await fetchTable2Rows(null, row.audit_session_id);
      return res.json(shapeSession(row, t1, t2));
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_session_serial_rows
            SET missing = FALSE, updated_at = NOW()
          WHERE audit_session_id = $1 AND missing = TRUE AND deleted_at IS NULL`,
        [row.audit_session_id]
      );
      await client.query(
        `UPDATE audit_sessions
            SET table1_state = 'Editing', last_activity_at = NOW(),
                auto_suspended_at = NULL, updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'Update', client);
    });
    const { row: fresh } = await loadSessionForActor(row.audit_session_id, req.session);
    res.json(shapeSession(fresh, await fetchTable1Rows(null, row.audit_session_id), await fetchTable2Rows(null, row.audit_session_id)));
  } catch (e) { next(e); }
});

// ===================================================================
// Table 2 — row PATCH, submit, modify
// ===================================================================

function validateCounter(value, field) {
  if (value === undefined) return { skip: true };
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > ROW_LIMIT_PER_COUNTER) {
    return { error: { code: 'bad_format', message: `Value '${value}' for '${field}' is not a valid non-negative integer (≤${ROW_LIMIT_PER_COUNTER}).`, fields: { [field]: `must be an integer between 0 and ${ROW_LIMIT_PER_COUNTER}` } } };
  }
  return { value: n };
}

router.patch('/:id/table2/rows/:rowId', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table2_state !== 'Editing') return err(res, 409, 'Table 2 has been submitted. Press Modify to re-open it before changing counts.', 'table2_frozen');

    const target = await one(
      `SELECT * FROM audit_session_accessory_rows
        WHERE audit_accessory_row_id = $1 AND audit_session_id = $2`,
      [Number(req.params.rowId), row.audit_session_id]
    );
    if (!target) return res.status(404).json({ error: 'not_found' });

    const working = validateCounter(req.body.working_count, 'working_count');
    const notWorking = validateCounter(req.body.not_working_count, 'not_working_count');
    if (working.error) return err(res, 422, working.error.message, working.error.code, working.error.fields);
    if (notWorking.error) return err(res, 422, notWorking.error.message, notWorking.error.code, notWorking.error.fields);

    const updates = [];
    const params = [];
    let hasChange = false;

    if (!working.skip && working.value !== target.working_count) {
      params.push(working.value);
      updates.push(`working_count = $${params.length}`);
      hasChange = true;
    }
    if (!notWorking.skip && notWorking.value !== target.not_working_count) {
      params.push(notWorking.value);
      updates.push(`not_working_count = $${params.length}`);
      hasChange = true;
    }

    if (!hasChange) return res.json(target);

    params.push(target.audit_accessory_row_id);
    const updatedRow = await withTransaction(async (client) => {
      const out = await client.query(
        `UPDATE audit_session_accessory_rows
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE audit_accessory_row_id = $${params.length}
          RETURNING *`,
        params
      );
      await logChange('AuditAccessoryRow', target.audit_accessory_row_id, req.session, 'Update', client);
      await bumpActivity(client, row.audit_session_id);
      return out.rows[0];
    });
    res.json(updatedRow);
  } catch (e) { next(e); }
});

router.post('/:id/table2/submit', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table2_state === 'Submitted') {
      const t1 = await fetchTable1Rows(null, row.audit_session_id);
      const t2 = await fetchTable2Rows(null, row.audit_session_id);
      return res.json(shapeSession(row, t1, t2));
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_session_accessory_rows
            SET missing_count = GREATEST(expected_quantity - working_count - not_working_count, 0),
                updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await client.query(
        `UPDATE audit_sessions
            SET table2_state = 'Submitted', last_activity_at = NOW(),
                auto_suspended_at = NULL, updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'Update', client);
    });
    const { row: fresh } = await loadSessionForActor(row.audit_session_id, req.session);
    res.json(shapeSession(fresh, await fetchTable1Rows(null, row.audit_session_id), await fetchTable2Rows(null, row.audit_session_id)));
  } catch (e) { next(e); }
});

router.post('/:id/table2/modify', requireAuth, requireAso, async (req, res, next) => {
  try {
    const { row, status } = await loadSessionForActor(req.params.id, req.session);
    if (!row) return res.status(status).json({ error: status === 403 ? 'forbidden' : 'not_found' });
    if (row.status === 'Cancelled') return err(res, 410, 'This audit was cancelled and cannot be modified.', 'audit_session_cancelled');
    if (row.status !== 'Incomplete') return err(res, 409, 'This audit is awaiting Store review and cannot be modified.', 'audit_session_frozen');
    if (row.table2_state === 'Editing') {
      const t1 = await fetchTable1Rows(null, row.audit_session_id);
      const t2 = await fetchTable2Rows(null, row.audit_session_id);
      return res.json(shapeSession(row, t1, t2));
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE audit_session_accessory_rows
            SET missing_count = NULL, updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await client.query(
        `UPDATE audit_sessions
            SET table2_state = 'Editing', last_activity_at = NOW(),
                auto_suspended_at = NULL, updated_at = NOW()
          WHERE audit_session_id = $1`,
        [row.audit_session_id]
      );
      await logChange('AuditSession', row.audit_index, req.session, 'Update', client);
    });
    const { row: fresh } = await loadSessionForActor(row.audit_session_id, req.session);
    res.json(shapeSession(fresh, await fetchTable1Rows(null, row.audit_session_id), await fetchTable2Rows(null, row.audit_session_id)));
  } catch (e) { next(e); }
});

// ===================================================================
// Auto-suspension job (5-minute timer, wired from server.js)
// ===================================================================

export async function runAuditSuspensionJob() {
  // Idempotent. Marks any Incomplete session whose last activity is >30 min old.
  await pool.query(
    `UPDATE audit_sessions
        SET auto_suspended_at = NOW(), updated_at = NOW()
      WHERE status = 'Incomplete'
        AND deleted_at IS NULL
        AND auto_suspended_at IS NULL
        AND last_activity_at < NOW() - INTERVAL '30 minutes'`
  );
}

export default router;
