import { Router } from 'express';
import multer from 'multer';
import { resolve, join, extname } from 'node:path';
import { unlinkSync, existsSync, renameSync } from 'node:fs';
import { pool, one, many, withTransaction } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { ValidationError, required } from '../lib/validate.js';

const router = Router();

const upload = multer({
  dest: resolve(config.uploadDir, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new ValidationError('only PDF allowed', { file: 'only PDF uploads are allowed' }));
    cb(null, true);
  },
});

async function isPaymentTerminal(sku_type_id) {
  const row = await one(`SELECT name FROM sku_types WHERE sku_type_id = $1`, [sku_type_id]);
  return row && row.name === 'Payment Terminal';
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { sku_type_id, status, vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('s.deleted_at IS NULL');
    if (sku_type_id) { params.push(Number(sku_type_id)); where.push(`s.sku_type_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
    if (vendor_id) {
      params.push(Number(vendor_id));
      where.push(
        `EXISTS (SELECT 1 FROM sku_vendor_links l
                   JOIN vendor_skus vs ON vs.vendor_sku_id = l.vendor_sku_id
                  WHERE l.sku_id = s.sku_id AND vs.vendor_id = $${params.length}
                    AND l.deleted_at IS NULL AND vs.deleted_at IS NULL)`
      );
    }
    // vendor_count: distinct vendors supplying this Innoviti SKU.
    // vendor_sku_ids: the currently-linked Vendor SKU ids in link order, so
    // the Modify form can pre-populate the multi-select.
    const sql = `SELECT s.*, st.name AS sku_type_name, st.serial_eligible,
                        COALESCE((
                          SELECT COUNT(DISTINCT vs.vendor_id)::int
                            FROM sku_vendor_links l
                            JOIN vendor_skus vs ON vs.vendor_sku_id = l.vendor_sku_id
                           WHERE l.sku_id = s.sku_id
                             AND l.deleted_at IS NULL
                             AND vs.deleted_at IS NULL
                        ), 0) AS vendor_count,
                        COALESCE((
                          SELECT array_agg(l.vendor_sku_id ORDER BY l.sku_vendor_link_id)
                            FROM sku_vendor_links l
                            JOIN vendor_skus vs ON vs.vendor_sku_id = l.vendor_sku_id
                           WHERE l.sku_id = s.sku_id
                             AND l.deleted_at IS NULL
                             AND vs.deleted_at IS NULL
                        ), ARRAY[]::int[]) AS vendor_sku_ids
                   FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY s.sku_id`;
    res.json(await many(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await one(
      `SELECT s.*, st.name AS sku_type_name, st.serial_eligible
         FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
        WHERE s.sku_id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    // Currently-linked Vendor SKU ids, for the Modify form to pre-populate.
    const links = await many(
      `SELECT l.vendor_sku_id FROM sku_vendor_links l
         JOIN vendor_skus vs ON vs.vendor_sku_id = l.vendor_sku_id
        WHERE l.sku_id = $1 AND l.deleted_at IS NULL AND vs.deleted_at IS NULL
        ORDER BY l.sku_vendor_link_id`,
      [id]
    );
    const vendor_sku_ids = links.map((l) => l.vendor_sku_id);
    // Resolve Payment Terminal component SKUs (adaptors, USB cables) so the UI can render
    // them with status and highlight inactive ones in red.
    const componentIds = [
      ...(Array.isArray(row.adaptor_sku_ids) ? row.adaptor_sku_ids : []),
      ...(Array.isArray(row.usb_cable_sku_ids) ? row.usb_cable_sku_ids : []),
    ].map(Number).filter(Number.isFinite);
    let componentMap = new Map();
    if (componentIds.length) {
      const comps = await many(
        `SELECT sku_id, sku_number, sku_name, status FROM skus WHERE sku_id = ANY($1::int[])`,
        [componentIds]
      );
      componentMap = new Map(comps.map((c) => [c.sku_id, c]));
    }
    const adaptors = (Array.isArray(row.adaptor_sku_ids) ? row.adaptor_sku_ids : [])
      .map((aid) => componentMap.get(Number(aid))).filter(Boolean);
    const usb_cables = (Array.isArray(row.usb_cable_sku_ids) ? row.usb_cable_sku_ids : [])
      .map((aid) => componentMap.get(Number(aid))).filter(Boolean);
    res.json({ ...row, vendor_sku_ids, adaptors, usb_cables });
  } catch (e) { next(e); }
});

function validatePrices(body, { moqKey = 'approx_price_moq', unitKey = 'approx_price_unit' } = {}) {
  const errors = {};
  const moq = body[moqKey];
  if (moq !== undefined && moq !== null && moq !== '') {
    const v = Number(moq);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
      errors[moqKey] = 'must be a positive integer (≥ 1). Cannot be negative or zero.';
    }
  }
  const unit = body[unitKey];
  if (unit !== undefined && unit !== null && unit !== '') {
    const v = Number(unit);
    if (!Number.isFinite(v) || v < 0) {
      errors[unitKey] = 'must be 0 or greater. Negative prices are not allowed.';
    }
  }
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

async function validateSkuCreate(body) {
  required(body, ['sku_name', 'stm', 'sku_type_id']);
  if (!['Serial', 'None'].includes(body.stm))
    throw new ValidationError('stm must be Serial or None', { stm: 'must be Serial or None' });
  validatePrices(body);
  const st = await one(`SELECT * FROM sku_types WHERE sku_type_id = $1 AND deleted_at IS NULL`, [body.sku_type_id]);
  if (!st) throw new ValidationError('invalid sku_type_id', { sku_type_id: 'must reference an existing SKU type' });
  // SKU name must be unique (case-insensitive) within its SKU Type.
  const dup = await one(
    `SELECT 1 FROM skus
      WHERE LOWER(sku_name) = LOWER($1) AND sku_type_id = $2 AND deleted_at IS NULL`,
    [body.sku_name, body.sku_type_id]
  );
  if (dup)
    throw new ValidationError('A SKU with this name already exists for this type', {
      sku_name: `a SKU named "${body.sku_name}" already exists in the "${st.name}" type`,
    });
  if (body.stm === 'Serial' && !st.serial_eligible)
    throw new ValidationError(`SKU type "${st.name}" is not Serial-eligible`, {
      stm: `the SKU type "${st.name}" cannot use Serial tracking; pick "None"`,
    });
  // Serial-eligible types MUST use Serial — "None" is not allowed for them.
  if (body.stm === 'None' && st.serial_eligible)
    throw new ValidationError(
      `SKU type "${st.name}" requires Serial tracking`,
      { stm: `"${st.name}" SKUs must be tracked by Serial number. "None" is not allowed for this type.` }
    );
  if (st.name === 'Payment Terminal') {
    const adaptors = Array.isArray(body.adaptor_sku_ids) ? body.adaptor_sku_ids : [];
    const usbs = Array.isArray(body.usb_cable_sku_ids) ? body.usb_cable_sku_ids : [];
    if (!adaptors.length || !usbs.length) {
      const adaptorsExist = await one(
        `SELECT COUNT(*)::int AS c FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
          WHERE st.name = 'Adaptors' AND s.deleted_at IS NULL`
      );
      const usbsExist = await one(
        `SELECT COUNT(*)::int AS c FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
          WHERE st.name = 'USB cables' AND s.deleted_at IS NULL`
      );
      const missing = [];
      if (!adaptorsExist.c) missing.push('Adaptor SKU');
      if (!usbsExist.c) missing.push('USB Cable SKU');
      if (missing.length)
        throw new ValidationError(
          `Cannot create Payment Terminal SKU — create ${missing.join(', ')} first`,
          { sku_type_id: `missing prerequisite SKUs: ${missing.join(', ')}. Create them first.` }
        );
      throw new ValidationError(
        'Payment Terminal requires adaptor and USB cable SKU selections',
        {
          adaptor_sku_ids: 'pick at least one adaptor SKU',
          usb_cable_sku_ids: 'pick at least one USB cable SKU',
        }
      );
    }
  }
}

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await validateSkuCreate(req.body);
    const idx = await nextIndex('sku');
    const isPT = await isPaymentTerminal(req.body.sku_type_id);
    const adaptors = isPT ? JSON.stringify(req.body.adaptor_sku_ids || []) : null;
    const usbs = isPT ? JSON.stringify(req.body.usb_cable_sku_ids || []) : null;

    // Optional: vendor SKUs picked on the create screen are linked at the same
    // time. Innoviti SKUs may be created with zero links — the matching Vendor
    // SKU may not exist yet. When ids are supplied, each must exist, be
    // non-deleted, and share this SKU's type.
    const vendorSkuIds = Array.isArray(req.body.vendor_sku_ids)
      ? [...new Set(req.body.vendor_sku_ids.map(Number).filter(Number.isFinite))]
      : [];
    if (vendorSkuIds.length) {
      const vskus = await many(
        `SELECT vendor_sku_id, sku_type_id FROM vendor_skus
          WHERE vendor_sku_id = ANY($1::int[]) AND deleted_at IS NULL`,
        [vendorSkuIds]
      );
      if (vskus.length !== vendorSkuIds.length)
        throw new ValidationError('invalid vendor_sku_ids', { vendor_sku_ids: 'one or more vendor SKUs do not exist' });
      if (vskus.some((v) => v.sku_type_id && v.sku_type_id !== Number(req.body.sku_type_id)))
        throw new ValidationError('vendor SKU type mismatch', { vendor_sku_ids: 'every vendor SKU must be of the same SKU type as this SKU' });
    }

    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO skus (sku_number, sku_name, description, stm, sku_type_id,
                            approx_price_moq, approx_price_unit, status,
                            adaptor_sku_ids, usb_cable_sku_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', $8::jsonb, $9::jsonb) RETURNING *`,
        [
          idx, req.body.sku_name, req.body.description || null, req.body.stm,
          req.body.sku_type_id, req.body.approx_price_moq || null, req.body.approx_price_unit || null,
          adaptors, usbs,
        ]
      );
      const sku = rows[0];
      await logChange('SKU', idx, req.session, 'Create', client);
      // The first linked vendor SKU becomes the SKU's default supplier.
      for (let i = 0; i < vendorSkuIds.length; i++) {
        const { rows: lr } = await client.query(
          `INSERT INTO sku_vendor_links (sku_id, vendor_sku_id, is_default)
           VALUES ($1, $2, $3) RETURNING sku_vendor_link_id`,
          [sku.sku_id, vendorSkuIds[i], i === 0]
        );
        await logChange('SkuVendorLink', lr[0].sku_vendor_link_id, req.session, 'Create', client);
      }
      return sku;
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (req.body.sku_type_id !== undefined && req.body.sku_type_id !== existing.sku_type_id)
      throw new ValidationError('sku_type_id is immutable after creation', { sku_type_id: 'cannot be changed after the SKU is created' });
    // Renaming must not collide with another SKU of the same type.
    if (req.body.sku_name !== undefined) {
      const dup = await one(
        `SELECT 1 FROM skus
          WHERE LOWER(sku_name) = LOWER($1) AND sku_type_id = $2
            AND sku_id <> $3 AND deleted_at IS NULL`,
        [req.body.sku_name, existing.sku_type_id, id]
      );
      if (dup)
        throw new ValidationError('A SKU with this name already exists for this type', {
          sku_name: `a SKU named "${req.body.sku_name}" already exists in this SKU type`,
        });
    }
    if (req.body.stm) {
      const st = await one(`SELECT name, serial_eligible FROM sku_types WHERE sku_type_id = $1`, [existing.sku_type_id]);
      if (req.body.stm === 'Serial' && !st.serial_eligible)
        throw new ValidationError('SKU type is not Serial-eligible', {
          stm: `the SKU type "${st.name}" cannot use Serial tracking`,
        });
      if (req.body.stm === 'None' && st.serial_eligible)
        throw new ValidationError(`SKU type "${st.name}" requires Serial tracking`, {
          stm: `"${st.name}" SKUs must be tracked by Serial number. "None" is not allowed for this type.`,
        });
    }
    validatePrices(req.body);
    const fields = ['sku_name', 'description', 'stm', 'approx_price_moq', 'approx_price_unit'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f] === '' ? null : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (await isPaymentTerminal(existing.sku_type_id)) {
      if (req.body.adaptor_sku_ids !== undefined) {
        params.push(JSON.stringify(req.body.adaptor_sku_ids));
        sets.push(`adaptor_sku_ids = $${params.length}::jsonb`);
      }
      if (req.body.usb_cable_sku_ids !== undefined) {
        params.push(JSON.stringify(req.body.usb_cable_sku_ids));
        sets.push(`usb_cable_sku_ids = $${params.length}::jsonb`);
      }
    }

    // Optional Vendor SKU link reconciliation. When the body carries
    // vendor_sku_ids (any array, including []), the link set is reconciled:
    // ids not currently linked are inserted, links no longer in the array are
    // soft-deleted. Default supplier is preserved when still in the set;
    // otherwise the first remaining link is promoted.
    const wantsLinkReconcile = Array.isArray(req.body.vendor_sku_ids);
    let newVendorSkuIds = [];
    if (wantsLinkReconcile) {
      newVendorSkuIds = [
        ...new Set(req.body.vendor_sku_ids.map(Number).filter(Number.isFinite)),
      ];
      if (newVendorSkuIds.length) {
        const vskus = await many(
          `SELECT vendor_sku_id, sku_type_id FROM vendor_skus
            WHERE vendor_sku_id = ANY($1::int[]) AND deleted_at IS NULL`,
          [newVendorSkuIds]
        );
        if (vskus.length !== newVendorSkuIds.length)
          throw new ValidationError('invalid vendor_sku_ids', { vendor_sku_ids: 'one or more vendor SKUs do not exist' });
        if (vskus.some((v) => v.sku_type_id && v.sku_type_id !== existing.sku_type_id))
          throw new ValidationError('vendor SKU type mismatch', { vendor_sku_ids: 'every vendor SKU must be of the same SKU type as this SKU' });
      }
    }

    if (!sets.length && !wantsLinkReconcile) return res.json(existing);
    if (sets.length) {
      sets.push(`updated_at = NOW()`);
      params.push(id);
    }

    const updated = await withTransaction(async (client) => {
      let row = existing;
      if (sets.length) {
        const { rows } = await client.query(
          `UPDATE skus SET ${sets.join(', ')} WHERE sku_id = $${params.length} RETURNING *`,
          params
        );
        row = rows[0];
        await logChange('SKU', existing.sku_number, req.session, 'Update', client);
      }
      if (wantsLinkReconcile) {
        const { rows: currentLinks } = await client.query(
          `SELECT sku_vendor_link_id, vendor_sku_id, is_default
             FROM sku_vendor_links
            WHERE sku_id = $1 AND deleted_at IS NULL`,
          [id]
        );
        const currentSet = new Set(currentLinks.map((l) => l.vendor_sku_id));
        const targetSet = new Set(newVendorSkuIds);
        const toAdd = newVendorSkuIds.filter((v) => !currentSet.has(v));
        const toRemove = currentLinks.filter((l) => !targetSet.has(l.vendor_sku_id));
        for (const l of toRemove) {
          await client.query(
            `UPDATE sku_vendor_links
                SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
              WHERE sku_vendor_link_id = $1`,
            [l.sku_vendor_link_id]
          );
          await logChange('SkuVendorLink', l.sku_vendor_link_id, req.session, 'SoftDelete', client);
        }
        for (const vsid of toAdd) {
          const { rows: lr } = await client.query(
            `INSERT INTO sku_vendor_links (sku_id, vendor_sku_id, is_default)
             VALUES ($1, $2, FALSE) RETURNING sku_vendor_link_id`,
            [id, vsid]
          );
          await logChange('SkuVendorLink', lr[0].sku_vendor_link_id, req.session, 'Create', client);
        }
        // If no live link has is_default = TRUE but at least one link survives,
        // promote the first one (by link_id) to default.
        const { rows: live } = await client.query(
          `SELECT sku_vendor_link_id, is_default
             FROM sku_vendor_links
            WHERE sku_id = $1 AND deleted_at IS NULL
            ORDER BY sku_vendor_link_id`,
          [id]
        );
        if (live.length && !live.some((l) => l.is_default)) {
          await client.query(
            `UPDATE sku_vendor_links SET is_default = TRUE, updated_at = NOW()
              WHERE sku_vendor_link_id = $1`,
            [live[0].sku_vendor_link_id]
          );
          await logChange('SkuVendorLink', live[0].sku_vendor_link_id, req.session, 'Update', client);
        }
      }
      return row;
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';
    await pool.query(`UPDATE skus SET status = $1, updated_at = NOW() WHERE sku_id = $2`, [newStatus, id]);
    await logChange('SKU', existing.sku_number, req.session, 'StatusToggle');
    res.json({ status: newStatus });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    await pool.query(`UPDATE skus SET deleted_at = NOW(), status = 'Inactive' WHERE sku_id = $1`, [id]);
    await logChange('SKU', existing.sku_number, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/restore', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (!existing.deleted_at) return res.status(409).json({ error: 'not_deleted' });
    await pool.query(`UPDATE skus SET deleted_at = NULL, updated_at = NOW() WHERE sku_id = $1`, [id]);
    await logChange('SKU', existing.sku_number, req.session, 'Restore');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post(
  '/:id/specifications',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
      if (!existing) return res.status(404).json({ error: 'not_found' });
      if (!req.file) return res.status(400).json({ error: 'file_required' });
      const finalName = `sku-${id}${extname(req.file.originalname) || '.pdf'}`;
      const finalPath = join(config.uploadDir, finalName);
      if (existing.specifications_pdf && existsSync(existing.specifications_pdf)) {
        try { unlinkSync(existing.specifications_pdf); } catch {}
      }
      renameSync(req.file.path, finalPath);
      await pool.query(
        `UPDATE skus SET specifications_pdf = $1, updated_at = NOW() WHERE sku_id = $2`,
        [finalPath, id]
      );
      await logChange('SKU', existing.sku_number, req.session, 'Upload');
      res.json({ ok: true, path: finalPath });
    } catch (e) { next(e); }
  }
);

// Per spec §8.3.b: the sku_vendor_links table is internal-only. There are
// intentionally no GET / POST / PATCH / DELETE / restore routes on
// /skus/{sku_id}/vendor-skus. Links are inserted only by POST /skus above and
// soft-deleted only as a cascade when their referenced Vendor SKU is
// soft-deleted (see routes/vendorSkus.js).

export default router;
