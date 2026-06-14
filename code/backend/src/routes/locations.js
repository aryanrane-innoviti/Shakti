import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { PINCODE_RE, ValidationError, required } from '../lib/validate.js';

const router = Router();

// Admin roles are never tied to a location.
const ADMIN_TYPES = ['SA', 'ADMIN'];

// A Location's children are read-only derived projections (task1.md §1.12, §9):
// the association lives on the child object (users.location_id / contacts.location_id),
// not on the Location. The Location form no longer assigns either.

// Non-admin users whose location_id points at this Location.
async function assignedNonAdminUsers(locationId) {
  return many(
    `SELECT u.user_id, u.user_index, u.first_name, u.last_name, u.email,
            ut.code AS user_type_code, ut.label AS user_type_label
       FROM users u
       JOIN user_types ut ON ut.user_type_id = u.user_type_id
      WHERE u.location_id = $1 AND u.deleted_at IS NULL
        AND ut.code <> ALL($2::text[])
      ORDER BY u.user_id`,
    [locationId, ADMIN_TYPES]
  );
}

// Contacts whose location_id points at this Location (soft-deleted ones kept,
// flagged — task1.md §4 / §9).
async function contactsAtLocation(locationId) {
  return many(
    `SELECT contact_id, contact_index, first_name, last_name, email,
            (deleted_at IS NOT NULL) AS deleted
       FROM contacts WHERE location_id = $1 ORDER BY contact_id`,
    [locationId]
  );
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('l.deleted_at IS NULL');
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`l.vendor_id = $${params.length}`); }
    const sql = `
      SELECT l.*, v.company_name AS vendor_name
        FROM locations l
        JOIN vendors v ON v.vendor_id = l.vendor_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY l.location_id`;
    res.json(await many(sql, params));
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
    res.json({
      ...row,
      assigned_users: await assignedNonAdminUsers(row.location_id),
      contacts: await contactsAtLocation(row.location_id),
    });
  } catch (e) { next(e); }
});

function validate(body, { existing, isCreate } = {}) {
  if (isCreate) required(body, ['vendor_id', 'location_name']);
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

// A Location carries only a vendor + name + address. Users and Contacts attach
// themselves from their own forms (task1.md §1.12).
const ADDRESS_FIELDS = ['location_name', 'address_line_1', 'address_line_2', 'pincode', 'city', 'state'];

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    validate(req.body, { isCreate: true });
    const vendor = await one(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
    if (!vendor) throw new ValidationError('vendor_id: must reference an existing, active vendor', { vendor_id: 'must reference an existing, active vendor' });

    const idx = await nextIndex('location');
    const cols = ['location_index', 'vendor_id', ...ADDRESS_FIELDS];
    const values = [idx, req.body.vendor_id, ...ADDRESS_FIELDS.map((f) => req.body[f] ?? null)];
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
    validate(req.body, { existing });

    if (req.body.vendor_id !== undefined && req.body.vendor_id !== existing.vendor_id) {
      if (req.session.user_type_code !== 'SA' && req.session.user_type_code !== 'ADMIN')
        return res.status(403).json({ error: 'only_sa_or_admin_can_change_vendor' });
      const v = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
      if (!v) throw new ValidationError('invalid vendor_id', { vendor_id: 'must reference an existing, active vendor' });
    }

    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (req.body.vendor_id !== undefined) push('vendor_id', req.body.vendor_id);
    for (const f of ['location_name', 'address_line_1', 'address_line_2', 'pincode', 'city', 'state']) {
      if (req.body[f] !== undefined) push(f, req.body[f] === '' ? null : req.body[f]);
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
    // Cannot retire a Location that still has assigned users — re-point them on
    // the User form first (task1.md §9). Referencing Contacts do NOT block.
    const assigned = await assignedNonAdminUsers(id);
    if (assigned.length) {
      return res.status(409).json({
        error: 'This location has assigned users. Re-point them on the User form before deleting it.',
        code: 'location_has_assigned_users',
        fields: { assigned_users: assigned.map((u) => u.user_id) },
      });
    }
    await pool.query(`UPDATE locations SET deleted_at = NOW() WHERE location_id = $1`, [id]);
    await logChange('Location', existing.location_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
