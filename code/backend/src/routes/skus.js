import { Router } from 'express';
import multer from 'multer';
import { resolve, join, extname } from 'node:path';
import { unlinkSync, existsSync, renameSync } from 'node:fs';
import { pool, one, many } from '../db.js';
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
        `EXISTS (SELECT 1 FROM sku_vendor_assocs a WHERE a.sku_id = s.sku_id AND a.vendor_id = $${params.length} AND a.deleted_at IS NULL)`
      );
    }
    const sql = `SELECT s.*, st.name AS sku_type_name, st.serial_eligible
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
      `SELECT s.*, st.name AS sku_type_name, st.serial_eligible,
              p.name AS parent_sku_name
         FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
         LEFT JOIN terminal_parent_skus p ON p.parent_sku_id = s.parent_sku_id
        WHERE s.sku_id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    const suppliers = await many(
      `SELECT a.*, v.company_name AS vendor_name, v.status AS vendor_status
         FROM sku_vendor_assocs a JOIN vendors v ON v.vendor_id = a.vendor_id
        WHERE a.sku_id = $1 AND a.deleted_at IS NULL
        ORDER BY a.sku_vendor_assoc_id`,
      [id]
    );
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
    let parent = null;
    if (row.parent_sku_id) {
      parent = await one(
        `SELECT parent_sku_id, parent_sku_number, name FROM terminal_parent_skus WHERE parent_sku_id = $1`,
        [row.parent_sku_id]
      );
    }
    res.json({ ...row, suppliers, adaptors, usb_cables, parent });
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
    if (!adaptors.length || !usbs.length || !body.parent_sku_id) {
      const adaptorsExist = await one(
        `SELECT COUNT(*)::int AS c FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
          WHERE st.name = 'Adaptors' AND s.deleted_at IS NULL`
      );
      const usbsExist = await one(
        `SELECT COUNT(*)::int AS c FROM skus s JOIN sku_types st ON st.sku_type_id = s.sku_type_id
          WHERE st.name = 'USB cables' AND s.deleted_at IS NULL`
      );
      const parents = await one(`SELECT COUNT(*)::int AS c FROM terminal_parent_skus`);
      const missing = [];
      if (!adaptorsExist.c) missing.push('Adaptor SKU');
      if (!usbsExist.c) missing.push('USB Cable SKU');
      if (!parents.c) missing.push('Terminal Parent SKU');
      if (missing.length)
        throw new ValidationError(
          `Cannot create Payment Terminal SKU — create ${missing.join(', ')} first`,
          { sku_type_id: `missing prerequisite SKUs: ${missing.join(', ')}. Create them first.` }
        );
      throw new ValidationError(
        'Payment Terminal requires adaptor, USB cable and parent SKU selections',
        {
          adaptor_sku_ids: 'pick at least one adaptor SKU',
          usb_cable_sku_ids: 'pick at least one USB cable SKU',
          parent_sku_id: 'pick a terminal parent SKU',
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
    const parent = isPT ? req.body.parent_sku_id : null;
    const { rows } = await pool.query(
      `INSERT INTO skus (sku_number, sku_name, description, stm, sku_type_id,
                          approx_price_moq, approx_price_unit, status,
                          parent_sku_id, adaptor_sku_ids, usb_cable_sku_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', $8, $9::jsonb, $10::jsonb) RETURNING *`,
      [
        idx, req.body.sku_name, req.body.description || null, req.body.stm,
        req.body.sku_type_id, req.body.approx_price_moq || null, req.body.approx_price_unit || null,
        parent, adaptors, usbs,
      ]
    );
    await logChange('SKU', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM skus WHERE sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (req.body.sku_type_id !== undefined && req.body.sku_type_id !== existing.sku_type_id)
      throw new ValidationError('sku_type_id is immutable after creation', { sku_type_id: 'cannot be changed after the SKU is created' });
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
      if (req.body.parent_sku_id !== undefined) {
        params.push(req.body.parent_sku_id);
        sets.push(`parent_sku_id = $${params.length}`);
      }
    }
    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE skus SET ${sets.join(', ')} WHERE sku_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('SKU', existing.sku_number, req.session, 'Update');
    res.json(rows[0]);
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

// Global list of every (SKU × Vendor) association — drives the "Manage Vendor SKU" screen.
router.get('/-/vendor-assocs', requireAuth, async (req, res, next) => {
  try {
    const { sku_id, vendor_id } = req.query;
    const where = ['a.deleted_at IS NULL'];
    const params = [];
    if (sku_id) { params.push(Number(sku_id)); where.push(`a.sku_id = $${params.length}`); }
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`a.vendor_id = $${params.length}`); }
    res.json(await many(
      `SELECT a.*,
              s.sku_number, s.sku_name, s.status AS sku_status,
              st.name AS sku_type_name,
              v.company_name AS vendor_name, v.status AS vendor_status
         FROM sku_vendor_assocs a
         JOIN skus s     ON s.sku_id = a.sku_id
         JOIN sku_types st ON st.sku_type_id = s.sku_type_id
         JOIN vendors v  ON v.vendor_id = a.vendor_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.sku_number, v.company_name, a.sku_vendor_assoc_id`,
      params
    ));
  } catch (e) { next(e); }
});

router.get('/:sku_id/vendors', requireAuth, async (req, res, next) => {
  try {
    res.json(
      await many(
        `SELECT a.*, v.company_name AS vendor_name, v.status AS vendor_status
           FROM sku_vendor_assocs a JOIN vendors v ON v.vendor_id = a.vendor_id
          WHERE a.sku_id = $1 AND a.deleted_at IS NULL
          ORDER BY a.sku_vendor_assoc_id`,
        [Number(req.params.sku_id)]
      )
    );
  } catch (e) { next(e); }
});

router.post('/:sku_id/vendors', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sku_id = Number(req.params.sku_id);
    const sku = await one(`SELECT sku_number FROM skus WHERE sku_id = $1`, [sku_id]);
    if (!sku) return res.status(404).json({ error: 'sku_not_found' });
    required(req.body, ['vendor_id', 'vendor_sku_number']);
    validatePrices(req.body, { moqKey: 'vendor_sku_price_moq', unitKey: 'vendor_sku_price_unit' });
    const vendor = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
    if (!vendor) throw new ValidationError('invalid vendor_id', { vendor_id: 'must reference an existing, active vendor' });
    const dup = await one(
      `SELECT 1 FROM sku_vendor_assocs
        WHERE sku_id = $1 AND vendor_id = $2 AND vendor_sku_number = $3 AND deleted_at IS NULL`,
      [sku_id, req.body.vendor_id, req.body.vendor_sku_number]
    );
    if (dup) return res.status(409).json({ error: 'duplicate_supplier_row' });
    const { rows } = await pool.query(
      `INSERT INTO sku_vendor_assocs (sku_id, vendor_id, vendor_sku_number, vendor_sku_price_moq, vendor_sku_price_unit)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        sku_id, req.body.vendor_id, req.body.vendor_sku_number,
        req.body.vendor_sku_price_moq || null,
        req.body.vendor_sku_price_unit || null,
      ]
    );
    await logChange('SKUVendorAssociation', rows[0].sku_vendor_assoc_id, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:sku_id/vendors/:assoc_id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const assoc_id = Number(req.params.assoc_id);
    const existing = await one(`SELECT * FROM sku_vendor_assocs WHERE sku_vendor_assoc_id = $1`, [assoc_id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    validatePrices(req.body, { moqKey: 'vendor_sku_price_moq', unitKey: 'vendor_sku_price_unit' });
    const fields = ['vendor_sku_number', 'vendor_sku_price_moq', 'vendor_sku_price_unit'];
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
    params.push(assoc_id);
    const { rows } = await pool.query(
      `UPDATE sku_vendor_assocs SET ${sets.join(', ')} WHERE sku_vendor_assoc_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('SKUVendorAssociation', assoc_id, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.get(
  '/:sku_id/vendors/:assoc_id/specification',
  requireAuth,
  async (req, res, next) => {
    try {
      const sku_id = Number(req.params.sku_id);
      const assoc_id = Number(req.params.assoc_id);
      const row = await one(
        `SELECT vendor_sku_specification_pdf FROM sku_vendor_assocs
          WHERE sku_vendor_assoc_id = $1 AND sku_id = $2 AND deleted_at IS NULL`,
        [assoc_id, sku_id]
      );
      if (!row || !row.vendor_sku_specification_pdf || !existsSync(row.vendor_sku_specification_pdf)) {
        return res.status(404).json({ error: 'not_found' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.sendFile(resolve(row.vendor_sku_specification_pdf));
    } catch (e) { next(e); }
  }
);

router.post(
  '/:sku_id/vendors/:assoc_id/specification',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const sku_id = Number(req.params.sku_id);
      const assoc_id = Number(req.params.assoc_id);
      const existing = await one(
        `SELECT * FROM sku_vendor_assocs WHERE sku_vendor_assoc_id = $1 AND sku_id = $2`,
        [assoc_id, sku_id]
      );
      if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
      if (!req.file) return res.status(400).json({ error: 'file_required' });
      const finalName = `sku-${sku_id}-vendor-${assoc_id}${extname(req.file.originalname) || '.pdf'}`;
      const finalPath = join(config.uploadDir, finalName);
      if (existing.vendor_sku_specification_pdf && existsSync(existing.vendor_sku_specification_pdf)) {
        try { unlinkSync(existing.vendor_sku_specification_pdf); } catch {}
      }
      renameSync(req.file.path, finalPath);
      await pool.query(
        `UPDATE sku_vendor_assocs SET vendor_sku_specification_pdf = $1, updated_at = NOW()
          WHERE sku_vendor_assoc_id = $2`,
        [finalPath, assoc_id]
      );
      await logChange('SKUVendorAssociation', assoc_id, req.session, 'Upload');
      res.json({ ok: true, path: finalPath });
    } catch (e) { next(e); }
  }
);

router.delete('/:sku_id/vendors/:assoc_id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const assoc_id = Number(req.params.assoc_id);
    const existing = await one(`SELECT * FROM sku_vendor_assocs WHERE sku_vendor_assoc_id = $1`, [assoc_id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    await pool.query(`UPDATE sku_vendor_assocs SET deleted_at = NOW() WHERE sku_vendor_assoc_id = $1`, [assoc_id]);
    await logChange('SKUVendorAssociation', assoc_id, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
