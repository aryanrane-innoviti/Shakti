import { Router } from 'express';
import { many } from '../db.js';
import { requireAuth, requireAdminRead } from '../lib/auth.js';

/**
 * Accessory stock balances — read-only in the Phase 3 ASO slice.
 *
 * Writes happen exclusively in the Store-review slice when a PendingReview
 * audit is approved. The ASO slice only READS this table to seed Table 2's
 * `expected_quantity`.
 */
const router = Router();

router.get('/', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const { location_id, vendor_sku_id } = req.query;
    const where = [];
    const params = [];
    if (location_id) { params.push(Number(location_id)); where.push(`asb.location_id = $${params.length}`); }
    if (vendor_sku_id) { params.push(Number(vendor_sku_id)); where.push(`asb.vendor_sku_id = $${params.length}`); }
    const rows = await many(
      `SELECT asb.*,
              vs.vendor_sku_number,
              vs.vendor_sku_name,
              v.vendor_id,
              v.company_name AS vendor_name,
              l.location_index,
              l.location_name
         FROM accessory_stock_balances asb
         JOIN vendor_skus vs ON vs.vendor_sku_id = asb.vendor_sku_id
         JOIN vendors v ON v.vendor_id = vs.vendor_id
         JOIN locations l ON l.location_id = asb.location_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY l.location_name, vs.vendor_sku_number`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
