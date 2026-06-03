import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin, requireAdminRead } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { getInnovitiVendorId } from '../lib/seedRefs.js';
import { GSTIN_RE, PINCODE_RE, ValidationError, required } from '../lib/validate.js';

const router = Router();

function blockNonSAFromSeed(req, res, isSeed) {
  if (isSeed && req.session.user_type_code !== 'SA') {
    res.status(403).json({ error: 'Only the Super Admin can modify the Innoviti seed vendor.' });
    return true;
  }
  return false;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, vendor_type_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('v.deleted_at IS NULL');
    if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
    if (vendor_type_id) { params.push(Number(vendor_type_id)); where.push(`v.vendor_type_id = $${params.length}`); }
    const sql = `SELECT v.*, vt.name AS vendor_type_name
                   FROM vendors v JOIN vendor_types vt ON vt.vendor_type_id = v.vendor_type_id
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY v.vendor_id`;
    res.json(await many(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT v.*, vt.name AS vendor_type_name FROM vendors v
         JOIN vendor_types vt ON vt.vendor_type_id = v.vendor_type_id
        WHERE v.vendor_id = $1`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.get('/:id/contacts', requireAuth, async (req, res, next) => {
  try {
    res.json(
      await many(`SELECT * FROM contacts WHERE vendor_id = $1 ORDER BY contact_id`, [Number(req.params.id)])
    );
  } catch (e) { next(e); }
});

async function validate(body, { existing, isCreate, vendorId } = {}) {
  if (isCreate) required(body, ['company_name', 'vendor_type_id']);
  const errors = {};
  const innovitiId = await getInnovitiVendorId();
  const isInnoviti = vendorId && vendorId === innovitiId;
  const gst = body.gst_number ?? existing?.gst_number;
  if (!isInnoviti) {
    if (isCreate && !gst) errors.gst_number = 'required (GSTIN is mandatory for non-Innoviti vendors)';
    else if (gst && !GSTIN_RE.test(gst)) errors.gst_number = 'must match the GSTIN format, e.g. 22AAAAA0000A1Z5';
  }
  for (const p of ['reg_pincode', 'op_pincode']) {
    const v = body[p] ?? existing?.[p];
    if (v && !PINCODE_RE.test(v)) errors[p] = 'must be exactly 6 digits';
  }
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

const FIELDS = [
  'company_name', 'vendor_type_id', 'gst_number',
  'reg_line_1', 'reg_line_2', 'reg_pincode', 'reg_city', 'reg_state',
  'op_line_1', 'op_line_2', 'op_pincode', 'op_city', 'op_state',
];

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await validate(req.body, { isCreate: true });
    const vt = await one(`SELECT * FROM vendor_types WHERE vendor_type_id = $1 AND deleted_at IS NULL`, [req.body.vendor_type_id]);
    if (!vt) throw new ValidationError('vendor_type_id: must reference an active vendor type', { vendor_type_id: 'must reference an active vendor type' });
    if (req.body.gst_number) {
      const dup = await one(`SELECT 1 FROM vendors WHERE gst_number = $1 AND deleted_at IS NULL`, [req.body.gst_number]);
      if (dup) return res.status(409).json({ error: 'gst_already_exists' });
    }
    const idx = await nextIndex('vendor');
    const cols = ['vendor_index', ...FIELDS, 'status'];
    const values = [idx, ...FIELDS.map((f) => req.body[f] ?? null), 'Active'];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO vendors (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await logChange('Vendor', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendors WHERE vendor_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (blockNonSAFromSeed(req, res, existing.is_seed)) return;
    await validate(req.body, { existing, vendorId: id });
    if (req.body.gst_number && req.body.gst_number !== existing.gst_number) {
      const dup = await one(
        `SELECT 1 FROM vendors WHERE gst_number = $1 AND vendor_id <> $2 AND deleted_at IS NULL`,
        [req.body.gst_number, id]
      );
      if (dup) return res.status(409).json({ error: 'gst_already_exists' });
    }
    const sets = [];
    const params = [];
    for (const f of FIELDS) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f] === '' ? null : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE vendors SET ${sets.join(', ')} WHERE vendor_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('Vendor', existing.vendor_index, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendors WHERE vendor_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (blockNonSAFromSeed(req, res, existing.is_seed)) return;
    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';
    await pool.query(`UPDATE vendors SET status = $1, updated_at = NOW() WHERE vendor_id = $2`, [newStatus, id]);
    await logChange('Vendor', existing.vendor_index, req.session, 'StatusToggle');
    res.json({ status: newStatus });
  } catch (e) { next(e); }
});

router.post('/:id/restore', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendors WHERE vendor_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (!existing.deleted_at) return res.status(409).json({ error: 'not_deleted' });
    if (blockNonSAFromSeed(req, res, existing.is_seed)) return;
    await pool.query(
      `UPDATE vendors SET deleted_at = NULL, updated_at = NOW() WHERE vendor_id = $1`,
      [id]
    );
    await logChange('Vendor', existing.vendor_index, req.session, 'Restore');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendors WHERE vendor_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    if (existing.is_seed) return res.status(409).json({ error: 'cannot_delete_innoviti_seed' });
    // The four dependency checks are independent reads — run them concurrently
    // so the handler waits on the slowest, not the sum of all four.
    const [users, contacts, locations, vendor_skus] = await Promise.all([
      many(`SELECT user_id, user_index FROM users WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]),
      many(`SELECT contact_id, contact_index FROM contacts WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]),
      many(`SELECT location_id, location_index FROM locations WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]),
      many(`SELECT vendor_sku_id FROM vendor_skus WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]),
    ]);
    const dependents = { users, contacts, locations, vendor_skus };
    const hasAny = Object.values(dependents).some((arr) => arr.length > 0);
    if (hasAny) return res.status(409).json({ error: 'has_dependents', dependents });
    await pool.query(`UPDATE vendors SET deleted_at = NOW(), status = 'Inactive' WHERE vendor_id = $1`, [id]);
    await logChange('Vendor', existing.vendor_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
