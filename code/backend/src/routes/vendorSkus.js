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

// A vendor SKU number is bound to a single name across the WHOLE catalogue: the
// same number must always carry the same name, regardless of which vendor stocks
// it (two vendors may share a number only when the name agrees). This is a
// cross-row functional dependency the per-vendor unique index can't express, so
// we guard it here on every write that sets a number/name. `excludeId` skips the
// row being updated/restored.
async function assertNameBinding({ vendor_sku_number, vendor_sku_name, excludeId = null }, client) {
  const number = vendor_sku_number;
  if (number === undefined || number === null || number === '') return;
  const norm = (s) => (s === undefined || s === null || s === '' ? null : String(s).trim());
  const name = norm(vendor_sku_name);
  const { rows } = await (client || pool).query(
    `SELECT DISTINCT vendor_sku_name
       FROM vendor_skus
      WHERE vendor_sku_number = $1
        AND deleted_at IS NULL
        AND ($2::int IS NULL OR vendor_sku_id <> $2)`,
    [number, excludeId]
  );
  for (const r of rows) {
    const existing = norm(r.vendor_sku_name);
    if (existing !== name) {
      const shown = existing ?? '(no name)';
      throw new ValidationError(
        `Vendor SKU number '${number}' is already in use with the name '${shown}'. The same number must use the same name — set the name to '${shown}', or use a different number.`,
        { vendor_sku_name: `must be '${shown}' for number '${number}'` }
      );
    }
  }
}

// The name of a SKU Type by id (used to detect Payment Terminal vendor SKUs).
async function skuTypeNameById(sku_type_id, client) {
  if (!sku_type_id) return null;
  const { rows } = await (client || pool).query(
    `SELECT name FROM sku_types WHERE sku_type_id = $1`,
    [sku_type_id]
  );
  return rows[0]?.name || null;
}

// Assert every id in `ids` is a live Vendor SKU of the given component type
// ("Adaptors" / "USB cables"). Returns the normalised, de-duplicated id list.
async function assertComponentType(ids, typeName, field, client) {
  const norm = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite))];
  if (!norm.length) return norm;
  const { rows } = await (client || pool).query(
    `SELECT vs.vendor_sku_id
       FROM vendor_skus vs JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
      WHERE vs.vendor_sku_id = ANY($1::int[]) AND vs.deleted_at IS NULL AND st.name = $2`,
    [norm, typeName]
  );
  if (rows.length !== norm.length)
    throw new ValidationError(`invalid ${field}`, {
      [field]: `every selection must be a live Vendor SKU of type "${typeName}"`,
    });
  return norm;
}

// Validate the adaptor + USB-cable references carried by a Payment Terminal
// vendor SKU. Both are compulsory (mirrors the original Innoviti-side rule, now
// at the physical Vendor SKU level). Returns the cleaned { adaptors, usbs } id
// arrays ready to be stored as JSONB.
async function validateComponentRefs(adaptorIds, usbIds, client) {
  const q = client || pool;
  const adaptors = [...new Set((Array.isArray(adaptorIds) ? adaptorIds : []).map(Number).filter(Number.isFinite))];
  const usbs = [...new Set((Array.isArray(usbIds) ? usbIds : []).map(Number).filter(Number.isFinite))];
  if (!adaptors.length || !usbs.length) {
    const { rows: ad } = await q.query(
      `SELECT COUNT(*)::int AS c FROM vendor_skus vs JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
        WHERE st.name = 'Adaptors' AND vs.deleted_at IS NULL`
    );
    const { rows: us } = await q.query(
      `SELECT COUNT(*)::int AS c FROM vendor_skus vs JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
        WHERE st.name = 'USB cables' AND vs.deleted_at IS NULL`
    );
    const missing = [];
    if (!ad[0].c) missing.push('Adaptor Vendor SKU');
    if (!us[0].c) missing.push('USB Cable Vendor SKU');
    if (missing.length)
      throw new ValidationError(
        `Cannot save a Payment Terminal Vendor SKU — create ${missing.join(', ')} first`,
        { sku_type_id: `missing prerequisite Vendor SKUs: ${missing.join(', ')}. Create them first.` }
      );
    throw new ValidationError('Payment Terminal Vendor SKU requires adaptor and USB cable selections', {
      adaptor_vendor_sku_ids: 'pick at least one adaptor Vendor SKU',
      usb_cable_vendor_sku_ids: 'pick at least one USB cable Vendor SKU',
    });
  }
  await assertComponentType(adaptors, 'Adaptors', 'adaptor_vendor_sku_ids', q);
  await assertComponentType(usbs, 'USB cables', 'usb_cable_vendor_sku_ids', q);
  return { adaptors, usbs };
}

// Resolve the adaptor / USB-cable id arrays on each row into lightweight
// { vendor_sku_id, vendor_sku_number, vendor_sku_name, status } objects so the
// UI can render them (and flag inactive references). Batches one lookup for the
// whole list. Mutates and returns the rows.
async function attachComponents(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const ids = new Set();
  for (const r of list) {
    for (const a of (Array.isArray(r.adaptor_vendor_sku_ids) ? r.adaptor_vendor_sku_ids : [])) ids.add(Number(a));
    for (const u of (Array.isArray(r.usb_cable_vendor_sku_ids) ? r.usb_cable_vendor_sku_ids : [])) ids.add(Number(u));
  }
  let map = new Map();
  if (ids.size) {
    const { rows: comps } = await pool.query(
      `SELECT vendor_sku_id, vendor_sku_number, vendor_sku_name, status
         FROM vendor_skus WHERE vendor_sku_id = ANY($1::int[])`,
      [[...ids]]
    );
    map = new Map(comps.map((c) => [c.vendor_sku_id, c]));
  }
  for (const r of list) {
    r.adaptors = (Array.isArray(r.adaptor_vendor_sku_ids) ? r.adaptor_vendor_sku_ids : [])
      .map((a) => map.get(Number(a))).filter(Boolean);
    r.usb_cables = (Array.isArray(r.usb_cable_vendor_sku_ids) ? r.usb_cable_vendor_sku_ids : [])
      .map((u) => map.get(Number(u))).filter(Boolean);
  }
  return rows;
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
    const rows = await many(
      `${LIST_SELECT}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY v.company_name, vs.vendor_sku_number`,
      params
    );
    res.json(await attachComponents(rows));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(`${LIST_SELECT} WHERE vs.vendor_sku_id = $1`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    await attachComponents(row);
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
      `SELECT name FROM sku_types WHERE sku_type_id = $1 AND deleted_at IS NULL`,
      [req.body.sku_type_id]
    );
    if (!skuType) throw new ValidationError('invalid sku_type_id', { sku_type_id: 'must reference an existing SKU type' });
    const dup = await one(
      `SELECT 1 FROM vendor_skus WHERE vendor_id = $1 AND vendor_sku_number = $2 AND deleted_at IS NULL`,
      [req.body.vendor_id, req.body.vendor_sku_number]
    );
    if (dup) return res.status(409).json({ error: 'duplicate_vendor_sku' });
    await assertNameBinding({ vendor_sku_number: req.body.vendor_sku_number, vendor_sku_name: req.body.vendor_sku_name });

    // A Payment Terminal vendor SKU carries its physical adaptor + USB-cable
    // references (other Vendor SKUs). Any other type never does.
    let adaptors = null, usbs = null;
    if (skuType.name === 'Payment Terminal') {
      const refs = await validateComponentRefs(req.body.adaptor_vendor_sku_ids, req.body.usb_cable_vendor_sku_ids);
      adaptors = JSON.stringify(refs.adaptors);
      usbs = JSON.stringify(refs.usbs);
    }

    const { rows } = await pool.query(
      `INSERT INTO vendor_skus
         (vendor_id, sku_type_id, vendor_sku_number, vendor_sku_name, vendor_sku_price_moq, vendor_sku_price_unit,
          adaptor_vendor_sku_ids, usb_cable_vendor_sku_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING *`,
      [
        req.body.vendor_id, req.body.sku_type_id, req.body.vendor_sku_number,
        req.body.vendor_sku_name || null,
        req.body.vendor_sku_price_moq || null,
        req.body.vendor_sku_price_unit || null,
        adaptors, usbs,
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
    // Enforce the number↔name binding whenever either is being set, using the
    // effective values (the incoming change merged over what's already stored).
    if (req.body.vendor_sku_number !== undefined || req.body.vendor_sku_name !== undefined) {
      await assertNameBinding({
        vendor_sku_number: req.body.vendor_sku_number !== undefined ? req.body.vendor_sku_number : existing.vendor_sku_number,
        vendor_sku_name: req.body.vendor_sku_name !== undefined ? req.body.vendor_sku_name : existing.vendor_sku_name,
        excludeId: id,
      });
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

    // Adaptor / USB-cable references are only meaningful on Payment Terminal
    // vendor SKUs. SKU Type is immutable, so the existing type decides this.
    if (req.body.adaptor_vendor_sku_ids !== undefined || req.body.usb_cable_vendor_sku_ids !== undefined) {
      if ((await skuTypeNameById(existing.sku_type_id)) === 'Payment Terminal') {
        const refs = await validateComponentRefs(
          req.body.adaptor_vendor_sku_ids !== undefined ? req.body.adaptor_vendor_sku_ids : existing.adaptor_vendor_sku_ids,
          req.body.usb_cable_vendor_sku_ids !== undefined ? req.body.usb_cable_vendor_sku_ids : existing.usb_cable_vendor_sku_ids
        );
        params.push(JSON.stringify(refs.adaptors));
        sets.push(`adaptor_vendor_sku_ids = $${params.length}::jsonb`);
        params.push(JSON.stringify(refs.usbs));
        sets.push(`usb_cable_vendor_sku_ids = $${params.length}::jsonb`);
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
      // Soft-delete every live link in one set-based UPDATE, then log them all
      // in one multi-row INSERT — instead of 1 + 2N round-trips for N links.
      const { rows: links } = await client.query(
        `UPDATE sku_vendor_links
            SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
          WHERE vendor_sku_id = $1 AND deleted_at IS NULL
          RETURNING sku_vendor_link_id`,
        [id]
      );
      if (links.length) {
        await client.query(
          `INSERT INTO change_log (object_type, object_id, actor_user_id, actor_user_index, action)
             SELECT 'SkuVendorLink', link_id::text, $1, $2, 'SoftDelete'
               FROM unnest($3::int[]) AS link_id`,
          [
            req.session?.user_id ?? null,
            req.session?.user_index ?? null,
            links.map((l) => l.sku_vendor_link_id),
          ]
        );
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
    await assertNameBinding({
      vendor_sku_number: existing.vendor_sku_number,
      vendor_sku_name: existing.vendor_sku_name,
      excludeId: id,
    });
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
