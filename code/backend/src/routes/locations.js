import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { PINCODE_RE, ValidationError, required } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('l.deleted_at IS NULL');
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`l.vendor_id = $${params.length}`); }
    const sql = `
      SELECT l.*, v.company_name AS vendor_name,
             pc.first_name AS pc_first, pc.last_name AS pc_last, pc.deleted_at AS pc_deleted, pc.vendor_id AS pc_vendor_id,
             sc.first_name AS sc_first, sc.last_name AS sc_last, sc.deleted_at AS sc_deleted, sc.vendor_id AS sc_vendor_id
        FROM locations l
        JOIN vendors v ON v.vendor_id = l.vendor_id
        LEFT JOIN contacts pc ON pc.contact_id = l.principal_contact_id
        LEFT JOIN contacts sc ON sc.contact_id = l.secondary_contact_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY l.location_id`;
    const rows = await many(sql, params);
    res.json(
      rows.map((r) => ({
        ...r,
        principal_contact_display: r.pc_first
          ? `${r.pc_first} ${r.pc_last}${r.pc_deleted ? ' (deleted)' : ''}${
              r.pc_vendor_id && r.pc_vendor_id !== r.vendor_id ? ' (other vendor)' : ''
            }`
          : null,
        secondary_contact_display: r.sc_first
          ? `${r.sc_first} ${r.sc_last}${r.sc_deleted ? ' (deleted)' : ''}${
              r.sc_vendor_id && r.sc_vendor_id !== r.vendor_id ? ' (other vendor)' : ''
            }`
          : null,
      }))
    );
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT l.*, v.company_name AS vendor_name
         FROM locations l JOIN vendors v ON v.vendor_id = l.vendor_id
        WHERE l.location_id = $1`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

function validate(body, { existing, isCreate } = {}) {
  if (isCreate) required(body, ['vendor_id', 'location_name', 'principal_contact_id']);
  const errors = {};
  const pincode = body.pincode ?? existing?.pincode;
  if (pincode && !PINCODE_RE.test(pincode)) errors.pincode = 'must be exactly 6 digits';
  const name = body.location_name ?? existing?.location_name;
  if (name && (name.length < 1 || name.length > 100))
    errors.location_name = 'must be 1–100 characters';
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

const FIELDS = [
  'location_name', 'address_line_1', 'address_line_2',
  'pincode', 'city', 'state',
  'principal_contact_id', 'secondary_contact_id',
];

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    validate(req.body, { isCreate: true });
    const vendor = await one(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
    if (!vendor) throw new ValidationError('vendor_id: must reference an existing, active vendor', { vendor_id: 'must reference an existing, active vendor' });
    const pc = await one(`SELECT * FROM contacts WHERE contact_id = $1 AND deleted_at IS NULL`, [req.body.principal_contact_id]);
    if (!pc) throw new ValidationError('principal_contact_id: must reference an existing, active contact', { principal_contact_id: 'must reference an existing, active contact' });
    if (pc.vendor_id !== req.body.vendor_id)
      throw new ValidationError('principal_contact_id: contact must belong to the selected vendor', { principal_contact_id: 'must belong to the selected vendor' });
    if (req.body.secondary_contact_id) {
      if (req.body.secondary_contact_id === req.body.principal_contact_id)
        throw new ValidationError('secondary_contact_id: must differ from principal contact', { secondary_contact_id: 'must differ from principal contact' });
      const sc = await one(`SELECT * FROM contacts WHERE contact_id = $1 AND deleted_at IS NULL`, [req.body.secondary_contact_id]);
      if (!sc) throw new ValidationError('secondary_contact_id: must reference an existing, active contact', { secondary_contact_id: 'must reference an existing, active contact' });
      if (sc.vendor_id !== req.body.vendor_id)
        throw new ValidationError('secondary_contact_id: contact must belong to the selected vendor', { secondary_contact_id: 'must belong to the selected vendor' });
    }
    const idx = await nextIndex('location');
    const cols = ['location_index', 'vendor_id', ...FIELDS];
    const values = [idx, req.body.vendor_id, ...FIELDS.map((f) => req.body[f] ?? null)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO locations (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await logChange('Location', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM locations WHERE location_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (req.body.vendor_id !== undefined && req.body.vendor_id !== existing.vendor_id) {
      if (req.session.user_type_code !== 'SA' && req.session.user_type_code !== 'ADMIN')
        return res.status(403).json({ error: 'only_sa_or_admin_can_change_vendor' });
      const v = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
      if (!v) throw new ValidationError('invalid vendor_id', ['vendor_id']);
    }
    if (req.body.principal_contact_id !== undefined) {
      const pc = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [req.body.principal_contact_id]);
      if (!pc || pc.deleted_at)
        throw new ValidationError('principal_contact_id: must reference an existing, active contact', { principal_contact_id: 'must reference an existing, active contact' });
      const vendorId = req.body.vendor_id ?? existing.vendor_id;
      if (pc.vendor_id !== vendorId)
        throw new ValidationError('principal_contact_id: contact must belong to the selected vendor', { principal_contact_id: 'must belong to the selected vendor' });
    }
    if (req.body.secondary_contact_id) {
      const sc = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [req.body.secondary_contact_id]);
      if (!sc || sc.deleted_at)
        throw new ValidationError('secondary_contact_id: must reference an existing, active contact', { secondary_contact_id: 'must reference an existing, active contact' });
      const vendorId = req.body.vendor_id ?? existing.vendor_id;
      if (sc.vendor_id !== vendorId)
        throw new ValidationError('secondary_contact_id: contact must belong to the selected vendor', { secondary_contact_id: 'must belong to the selected vendor' });
      const principalId = req.body.principal_contact_id ?? existing.principal_contact_id;
      if (sc.contact_id === principalId)
        throw new ValidationError('secondary_contact_id: must differ from principal contact', { secondary_contact_id: 'must differ from principal contact' });
    }
    const fields = ['vendor_id', ...FIELDS];
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
      `UPDATE locations SET ${sets.join(', ')} WHERE location_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('Location', existing.location_index, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM locations WHERE location_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    await pool.query(`UPDATE locations SET deleted_at = NOW() WHERE location_id = $1`, [id]);
    await logChange('Location', existing.location_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
