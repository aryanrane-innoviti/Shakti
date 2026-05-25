import { Router } from 'express';
import { many, one } from '../db.js';
import { requireAuth, requireAdminRead } from '../lib/auth.js';

const router = Router();

/**
 * Attach a human-readable `object_label` to every change-log row of a given
 * object_type. `fetchLabels` receives the numeric ids and returns a
 * Map<string id, string label>.
 */
async function enrichLabels(rows, objectType, fetchLabels) {
  const ids = rows
    .filter((r) => r.object_type === objectType && /^\d+$/.test(String(r.object_id)))
    .map((r) => Number(r.object_id));
  if (!ids.length) return;
  const byId = await fetchLabels(ids);
  for (const r of rows) {
    if (r.object_type === objectType) {
      const label = byId.get(String(r.object_id));
      if (label) r.object_label = label;
    }
  }
}

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

    // Vendor SKU — "vendor SKU # / Vendor".
    await enrichLabels(rows, 'VendorSku', async (ids) => {
      const vskus = await many(
        `SELECT vs.vendor_sku_id, vs.vendor_sku_number, v.company_name
           FROM vendor_skus vs JOIN vendors v ON v.vendor_id = vs.vendor_id
          WHERE vs.vendor_sku_id = ANY($1::int[])`,
        [ids]
      );
      return new Map(vskus.map((x) => [String(x.vendor_sku_id), `${x.vendor_sku_number} / ${x.company_name}`]));
    });

    // Innoviti SKU ↔ Vendor SKU link — "INN-### ↔ vendor SKU #".
    await enrichLabels(rows, 'SkuVendorLink', async (ids) => {
      const links = await many(
        `SELECT l.sku_vendor_link_id, s.sku_number, vs.vendor_sku_number
           FROM sku_vendor_links l
           JOIN skus s ON s.sku_id = l.sku_id
           JOIN vendor_skus vs ON vs.vendor_sku_id = l.vendor_sku_id
          WHERE l.sku_vendor_link_id = ANY($1::int[])`,
        [ids]
      );
      return new Map(links.map((x) => [String(x.sku_vendor_link_id), `${x.sku_number} ↔ ${x.vendor_sku_number}`]));
    });

    // Pre-many-to-many 'SKUVendorAssociation' entries keep their raw object_id
    // label — the legacy sku_vendor_assocs table they pointed at is gone.

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
