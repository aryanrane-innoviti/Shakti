import { Router } from 'express';
import multer from 'multer';
import { resolve, join, extname } from 'node:path';
import { unlinkSync, existsSync, renameSync } from 'node:fs';
import { pool, one, many, withTransaction } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { ValidationError, required } from '../lib/validate.js';

/**
 * Vendor SKU catalog (Phase 1 of the many-to-many rework).
 *
 * A vendor SKU is now a first-class entity owned by a vendor — number, name,
 * pricing and spec PDF live here once. It is linked to one or more Innoviti
 * SKUs through `sku_vendor_links` (managed from the Innoviti SKU side, see
 * routes/skus.js).
 */
const router = Router();

const upload = multer({
  dest: resolve(config.uploadDir, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new ValidationError('only PDF allowed', { file: 'only PDF uploads are allowed' }));
    cb(null, true);
  },
});

// Shared validation for MOQ / unit price (mirrors validatePrices in skus.js).
function validatePrices(body) {
  const errors = {};
  const moq = body.vendor_sku_price_moq;
  if (moq !== undefined && moq !== null && moq !== '') {
    const v = Number(moq);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
      errors.vendor_sku_price_moq = 'must be a positive integer (≥ 1). Cannot be negative or zero.';
    }
  }
  const unit = body.vendor_sku_price_unit;
  if (unit !== undefined && unit !== null && unit !== '') {
    const v = Number(unit);
    if (!Number.isFinite(v) || v < 0) {
      errors.vendor_sku_price_unit = 'must be 0 or greater. Negative prices are not allowed.';
    }
  }
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

// SELECT fragment that attaches the vendor name and the vendor SKU's SKU Type
// name. Per spec §8.3.b the sku_vendor_links table is internal-only, so the
// list of Innoviti SKUs each vendor SKU is linked to is NOT surfaced here.
const LIST_SELECT = `
  SELECT vs.*, v.company_name AS vendor_name, v.status AS vendor_status,
         st.name AS sku_type_name
    FROM vendor_skus vs
    JOIN vendors v ON v.vendor_id = vs.vendor_id
    LEFT JOIN sku_types st ON st.sku_type_id = vs.sku_type_id`;

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { vendor_id, status, sku_type_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('vs.deleted_at IS NULL');
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`vs.vendor_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`vs.status = $${params.length}`); }
    if (sku_type_id) { params.push(Number(sku_type_id)); where.push(`vs.sku_type_id = $${params.length}`); }
    res.json(await many(
      `${LIST_SELECT}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY v.company_name, vs.vendor_sku_number`,
      params
    ));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(`${LIST_SELECT} WHERE vs.vendor_sku_id = $1`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    required(req.body, ['vendor_id', 'vendor_sku_number', 'sku_type_id']);
    validatePrices(req.body);
    const vendor = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
    if (!vendor) throw new ValidationError('invalid vendor_id', { vendor_id: 'must reference an existing, active vendor' });
    const skuType = await one(
      `SELECT 1 FROM sku_types WHERE sku_type_id = $1 AND deleted_at IS NULL`,
      [req.body.sku_type_id]
    );
    if (!skuType) throw new ValidationError('invalid sku_type_id', { sku_type_id: 'must reference an existing SKU type' });
    const dup = await one(
      `SELECT 1 FROM vendor_skus WHERE vendor_id = $1 AND vendor_sku_number = $2 AND deleted_at IS NULL`,
      [req.body.vendor_id, req.body.vendor_sku_number]
    );
    if (dup) return res.status(409).json({ error: 'duplicate_vendor_sku' });
    const { rows } = await pool.query(
      `INSERT INTO vendor_skus
         (vendor_id, sku_type_id, vendor_sku_number, vendor_sku_name, vendor_sku_price_moq, vendor_sku_price_unit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.body.vendor_id, req.body.sku_type_id, req.body.vendor_sku_number,
        req.body.vendor_sku_name || null,
        req.body.vendor_sku_price_moq || null,
        req.body.vendor_sku_price_unit || null,
      ]
    );
    await logChange('VendorSku', rows[0].vendor_sku_id, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendor_skus WHERE vendor_sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    validatePrices(req.body);
    // The number must stay unique within the vendor.
    if (req.body.vendor_sku_number !== undefined && req.body.vendor_sku_number !== existing.vendor_sku_number) {
      const dup = await one(
        `SELECT 1 FROM vendor_skus
          WHERE vendor_id = $1 AND vendor_sku_number = $2 AND vendor_sku_id <> $3 AND deleted_at IS NULL`,
        [existing.vendor_id, req.body.vendor_sku_number, id]
      );
      if (dup) return res.status(409).json({ error: 'duplicate_vendor_sku' });
    }
    const fields = ['vendor_sku_number', 'vendor_sku_name', 'vendor_sku_price_moq', 'vendor_sku_price_unit'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f] === '' ? null : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE vendor_skus SET ${sets.join(', ')} WHERE vendor_sku_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('VendorSku', id, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendor_skus WHERE vendor_sku_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';
    await pool.query(`UPDATE vendor_skus SET status = $1, updated_at = NOW() WHERE vendor_sku_id = $2`, [newStatus, id]);
    await logChange('VendorSku', id, req.session, 'StatusToggle');
    res.json({ status: newStatus });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendor_skus WHERE vendor_sku_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    // Per spec §8.3.a: soft-deleting a Vendor SKU cascades to soft-delete any
    // non-deleted sku_vendor_links rows that reference it, in the same
    // transaction. The link table is internal-only — no 409 guard surfaced.
    await withTransaction(async (client) => {
      const { rows: links } = await client.query(
        `SELECT sku_vendor_link_id FROM sku_vendor_links
          WHERE vendor_sku_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      for (const l of links) {
        await client.query(
          `UPDATE sku_vendor_links SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
            WHERE sku_vendor_link_id = $1`,
          [l.sku_vendor_link_id]
        );
        await logChange('SkuVendorLink', l.sku_vendor_link_id, req.session, 'SoftDelete', client);
      }
      await client.query(
        `UPDATE vendor_skus SET deleted_at = NOW(), status = 'Inactive' WHERE vendor_sku_id = $1`,
        [id]
      );
      await logChange('VendorSku', id, req.session, 'SoftDelete', client);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/restore', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendor_skus WHERE vendor_sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (!existing.deleted_at) return res.status(409).json({ error: 'not_deleted' });
    const dup = await one(
      `SELECT 1 FROM vendor_skus
        WHERE vendor_id = $1 AND vendor_sku_number = $2 AND vendor_sku_id <> $3 AND deleted_at IS NULL`,
      [existing.vendor_id, existing.vendor_sku_number, id]
    );
    if (dup) return res.status(409).json({ error: 'duplicate_vendor_sku' });
    await pool.query(
      `UPDATE vendor_skus SET deleted_at = NULL, updated_at = NOW() WHERE vendor_sku_id = $1`,
      [id]
    );
    await logChange('VendorSku', id, req.session, 'Restore');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/specification', requireAuth, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT vendor_sku_specification_pdf FROM vendor_skus WHERE vendor_sku_id = $1`,
      [Number(req.params.id)]
    );
    if (!row || !row.vendor_sku_specification_pdf || !existsSync(row.vendor_sku_specification_pdf)) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(resolve(row.vendor_sku_specification_pdf));
  } catch (e) { next(e); }
});

router.post(
  '/:id/specification',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await one(`SELECT * FROM vendor_skus WHERE vendor_sku_id = $1`, [id]);
      if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
      if (!req.file) return res.status(400).json({ error: 'file_required' });
      const finalName = `vendor-sku-${id}${extname(req.file.originalname) || '.pdf'}`;
      const finalPath = join(config.uploadDir, finalName);
      if (existing.vendor_sku_specification_pdf && existsSync(existing.vendor_sku_specification_pdf)) {
        try { unlinkSync(existing.vendor_sku_specification_pdf); } catch {}
      }
      renameSync(req.file.path, finalPath);
      await pool.query(
        `UPDATE vendor_skus SET vendor_sku_specification_pdf = $1, updated_at = NOW() WHERE vendor_sku_id = $2`,
        [finalPath, id]
      );
      await logChange('VendorSku', id, req.session, 'Upload');
      res.json({ ok: true, path: finalPath });
    } catch (e) { next(e); }
  }
);

export default router;
