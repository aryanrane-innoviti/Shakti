import { Router } from 'express';
import { one, many } from '../db.js';
import { requireAuth, requireAdminRead } from '../lib/auth.js';

const router = Router();

// Each master is read-only in Phase 2. Filters: state, present_location_id
// (accepts the literal 'null' for unaudited rows); plus per-kind:
//   Payment Terminal / Base Station — vendor_sku_id (accepts 'null' for rows
//     with no resolved vendor SKU), sku_id (accepts 'null'; used to pin a
//     vendor-SKU-less roll-up group to its own Innoviti SKU), owner_vendor_id,
//     date_of_purchase_from/_to.
//   SIM Card — sku_id, owner_vendor_id, date_of_purchase_from/_to.
function buildFilters(req, opts) {
  const where = ['m.deleted_at IS NULL'];
  const params = [];
  const q = req.query;

  if (q.state) { params.push(q.state); where.push(`m.state = $${params.length}`); }

  if (opts.hasVendorSku) {
    if (q.vendor_sku_id === 'null') {
      where.push(`m.vendor_sku_id IS NULL`);
    } else if (q.vendor_sku_id) {
      params.push(Number(q.vendor_sku_id));
      where.push(`m.vendor_sku_id = $${params.length}`);
    }
    // A roll-up group with no vendor SKU is keyed by the unit's own Innoviti
    // SKU, so the unit list disambiguates by sku_id too ('null' = a unit with
    // neither a vendor SKU nor an Innoviti SKU).
    if (q.sku_id === 'null') {
      where.push(`m.sku_id IS NULL`);
    } else if (q.sku_id) {
      params.push(Number(q.sku_id));
      where.push(`m.sku_id = $${params.length}`);
    }
  } else if (q.sku_id) {
    params.push(Number(q.sku_id));
    where.push(`m.sku_id = $${params.length}`);
  }

  if (opts.hasOwner && q.owner_vendor_id) {
    params.push(Number(q.owner_vendor_id));
    where.push(`m.owner_vendor_id = $${params.length}`);
  }

  if (q.present_location_id === 'null') {
    where.push(`m.present_location_id IS NULL`);
  } else if (q.present_location_id) {
    params.push(Number(q.present_location_id));
    where.push(`m.present_location_id = $${params.length}`);
  }

  if (opts.hasDate && q.date_of_purchase_from) {
    params.push(q.date_of_purchase_from);
    where.push(`m.date_of_purchase >= $${params.length}`);
  }
  if (opts.hasDate && q.date_of_purchase_to) {
    params.push(q.date_of_purchase_to);
    where.push(`m.date_of_purchase <= $${params.length}`);
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function selectColumns(table, opts) {
  // Project the same shape regardless of which kind. Owner / date / vendor-SKU
  // columns are NULL on kinds that don't have them.
  const ownerJoin = opts.hasOwner
    ? `LEFT JOIN vendors v ON v.vendor_id = m.owner_vendor_id`
    : '';
  const ownerCols = opts.hasOwner
    ? `m.owner_vendor_id, v.company_name AS owner_vendor_name,`
    : `NULL::int AS owner_vendor_id, NULL::text AS owner_vendor_name,`;
  const dateCol = opts.hasDate ? `m.date_of_purchase,` : `NULL::date AS date_of_purchase,`;
  const vskuCol = opts.hasVendorSku
    ? `m.vendor_sku_id, m.vendor_sku_number_snapshot,`
    : `NULL::int AS vendor_sku_id, NULL::text AS vendor_sku_number_snapshot,`;

  return {
    sql: `
      SELECT m.${opts.pk} AS master_id,
             m.sku_id, m.sku_number_snapshot, m.sku_name_snapshot, m.sku_description_snapshot,
             ${vskuCol}
             ${ownerCols}
             ${dateCol}
             m.${opts.indexCol} AS index_value,
             m.present_location_id, l.location_name AS present_location_name,
             m.present_location_since, m.last_audited_at, m.state,
             m.loaded_via_attempt_id, m.created_at, m.updated_at
        FROM ${table} m
        LEFT JOIN locations l ON l.location_id = m.present_location_id
        ${ownerJoin}`,
    indexCol: opts.indexCol,
  };
}

function makeList(opts) {
  return async (req, res, next) => {
    try {
      const { whereSql, params } = buildFilters(req, opts);
      const { sql, indexCol } = selectColumns(opts.table, opts);
      const rows = await many(
        `${sql} ${whereSql} ORDER BY m.${opts.pk} DESC LIMIT 1000`,
        params
      );
      // Re-expose indexCol under its canonical name too.
      res.json(rows.map((r) => ({ ...r, [indexCol]: r.index_value })));
    } catch (e) { next(e); }
  };
}

function makeRead(opts) {
  return async (req, res, next) => {
    try {
      const { sql, indexCol } = selectColumns(opts.table, opts);
      const row = await one(`${sql} WHERE m.${opts.pk} = $1`, [Number(req.params.id)]);
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.json({ ...row, [indexCol]: row.index_value });
    } catch (e) { next(e); }
  };
}

// Roll-up: unit counts grouped by (Innoviti SKU x Vendor SKU), with a
// per-state breakdown.
//
// Payment Terminal / Base Station units belong to a vendor SKU. A vendor SKU
// may be linked to several Innoviti SKUs, so a unit is counted under EACH
// linked Innoviti SKU — the per-Innoviti-SKU figures are "logical" and a
// shared unit is counted more than once. View Stock derives the "physical"
// (distinct-unit) total by collapsing on vendor SKU. SIM Cards have no vendor
// SKU layer, so each row is one Innoviti SKU and logical == physical.
function makeSummary(opts) {
  return async (req, res, next) => {
    try {
      const { whereSql, params } = buildFilters(req, opts);
      let rows;
      if (opts.hasVendorSku) {
        // LEFT JOINs keep units visible even when their vendor SKU has no live
        // link (or no vendor SKU at all). When the vendor-SKU link chain yields
        // no Innoviti SKU, fall back to the unit's own sku_id / snapshot so a
        // unit loaded without a vendor SKU (e.g. legacy rows) still shows its
        // Innoviti SKU instead of landing in an unlabelled NULL group.
        rows = await many(
          `SELECT COALESCE(s.sku_id, m.sku_id)                  AS sku_id,
                  COALESCE(s.sku_number, m.sku_number_snapshot) AS sku_number,
                  COALESCE(s.sku_name, m.sku_name_snapshot)     AS sku_name,
                  vs.vendor_sku_id, vs.vendor_sku_number,
                  m.state, COUNT(*)::int AS n
             FROM ${opts.table} m
             LEFT JOIN vendor_skus vs    ON vs.vendor_sku_id = m.vendor_sku_id
             LEFT JOIN sku_vendor_links l ON l.vendor_sku_id = vs.vendor_sku_id AND l.deleted_at IS NULL
             LEFT JOIN skus s            ON s.sku_id = l.sku_id
             ${whereSql}
            GROUP BY COALESCE(s.sku_id, m.sku_id),
                     COALESCE(s.sku_number, m.sku_number_snapshot),
                     COALESCE(s.sku_name, m.sku_name_snapshot),
                     vs.vendor_sku_id, vs.vendor_sku_number, m.state`,
          params
        );
      } else {
        rows = await many(
          `SELECT m.sku_id, m.sku_number_snapshot AS sku_number, m.sku_name_snapshot AS sku_name,
                  NULL::int AS vendor_sku_id, NULL::text AS vendor_sku_number,
                  m.state, COUNT(*)::int AS n
             FROM ${opts.table} m
             ${whereSql}
            GROUP BY m.sku_id, m.sku_number_snapshot, m.sku_name_snapshot, m.state`,
          params
        );
      }
      // Fold the per-state rows into one entry per (Innoviti SKU, Vendor SKU).
      const groups = new Map();
      for (const r of rows) {
        const key = `${r.sku_id ?? ''}::${r.vendor_sku_id ?? ''}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            sku_id: r.sku_id,
            sku_number: r.sku_number,
            sku_name: r.sku_name,
            vendor_sku_id: r.vendor_sku_id,
            vendor_sku_number: r.vendor_sku_number,
            total: 0,
            by_state: {},
          };
          groups.set(key, g);
        }
        g.total += r.n;
        g.by_state[r.state] = (g.by_state[r.state] || 0) + r.n;
      }
      // Unlabelled groups sort last ('~' > any letter/digit).
      const out = [...groups.values()].sort((a, b) =>
        String(a.sku_number || '~').localeCompare(String(b.sku_number || '~')) ||
        String(a.vendor_sku_number || '~').localeCompare(String(b.vendor_sku_number || '~'))
      );
      res.json(out);
    } catch (e) { next(e); }
  };
}

const PT = { table: 'payment_terminal_master', pk: 'payment_terminal_master_id', indexCol: 'serial_number', hasOwner: true,  hasDate: true,  hasVendorSku: true  };
const SC = { table: 'sim_card_master',         pk: 'sim_card_master_id',         indexCol: 'sim_card_number', hasOwner: true,  hasDate: true,  hasVendorSku: false };
const BS = { table: 'base_station_master',     pk: 'base_station_master_id',     indexCol: 'serial_number', hasOwner: true,  hasDate: true,  hasVendorSku: true  };

// NB: /summary is registered before /:id so the literal isn't captured as an id.
router.get('/payment-terminals/summary', requireAuth, requireAdminRead, makeSummary(PT));
router.get('/payment-terminals',         requireAuth, requireAdminRead, makeList(PT));
router.get('/payment-terminals/:id',     requireAuth, requireAdminRead, makeRead(PT));
router.get('/sim-cards/summary',         requireAuth, requireAdminRead, makeSummary(SC));
router.get('/sim-cards',                 requireAuth, requireAdminRead, makeList(SC));
router.get('/sim-cards/:id',             requireAuth, requireAdminRead, makeRead(SC));
router.get('/base-stations/summary',     requireAuth, requireAdminRead, makeSummary(BS));
router.get('/base-stations',             requireAuth, requireAdminRead, makeList(BS));
router.get('/base-stations/:id',         requireAuth, requireAdminRead, makeRead(BS));

export default router;
