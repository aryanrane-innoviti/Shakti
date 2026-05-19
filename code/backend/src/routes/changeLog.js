import { Router } from 'express';
import { many, one } from '../db.js';
import { requireAuth, requireAdminRead } from '../lib/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const { object_type, object_id, actor_user_id, since, until, limit = 200 } = req.query;
    const where = [];
    const params = [];
    if (object_type) { params.push(object_type); where.push(`object_type = $${params.length}`); }
    if (object_id) { params.push(String(object_id)); where.push(`object_id = $${params.length}`); }
    if (actor_user_id) { params.push(Number(actor_user_id)); where.push(`actor_user_id = $${params.length}`); }
    if (since) { params.push(since); where.push(`occurred_at >= $${params.length}`); }
    if (until) { params.push(until); where.push(`occurred_at <= $${params.length}`); }
    params.push(Number(limit));
    const sql = `SELECT * FROM change_log ${
      where.length ? 'WHERE ' + where.join(' AND ') : ''
    } ORDER BY occurred_at DESC LIMIT $${params.length}`;
    const rows = await many(sql, params);
    // Enrich SKUVendorAssociation rows with a human-readable label "INN-### / Vendor"
    const assocIds = rows
      .filter((r) => r.object_type === 'SKUVendorAssociation' && /^\d+$/.test(String(r.object_id)))
      .map((r) => Number(r.object_id));
    if (assocIds.length) {
      const assocs = await many(
        `SELECT a.sku_vendor_assoc_id, s.sku_number, v.company_name
           FROM sku_vendor_assocs a
           JOIN skus s ON s.sku_id = a.sku_id
           JOIN vendors v ON v.vendor_id = a.vendor_id
          WHERE a.sku_vendor_assoc_id = ANY($1::int[])`,
        [assocIds]
      );
      const byId = new Map(assocs.map((a) => [String(a.sku_vendor_assoc_id), `${a.sku_number} / ${a.company_name}`]));
      for (const r of rows) {
        if (r.object_type === 'SKUVendorAssociation') {
          const label = byId.get(String(r.object_id));
          if (label) r.object_label = label;
        }
      }
    }
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:object_type/:object_id', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    res.json(
      await many(
        `SELECT * FROM change_log WHERE object_type = $1 AND object_id = $2 ORDER BY occurred_at DESC`,
        [req.params.object_type, req.params.object_id]
      )
    );
  } catch (e) { next(e); }
});

export default router;
