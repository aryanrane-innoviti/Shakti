import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin, requireAdminRead } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { NAME_RE, MOBILE_RE, ValidationError, emailValid, required } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const { vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('c.deleted_at IS NULL');
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`c.vendor_id = $${params.length}`); }
    const sql = `SELECT c.*, v.company_name AS vendor_name FROM contacts c
                   LEFT JOIN vendors v ON v.vendor_id = c.vendor_id
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY c.contact_id`;
    res.json(await many(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT c.*, v.company_name AS vendor_name FROM contacts c
        LEFT JOIN vendors v ON v.vendor_id = c.vendor_id
       WHERE c.contact_id = $1`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

const NAME_REASON =
  "must start with a letter and use only letters, space, hyphen (-) or apostrophe (').";
const EMAIL_REASON = 'not a valid email address.';
const MOBILE_REASON = 'must be exactly 10 digits starting with 6, 7, 8 or 9.';

function validate(body, { isCreate, existing } = {}) {
  if (isCreate) required(body, ['first_name', 'last_name', 'email', 'vendor_id']);
  const errors = {};
  const first_name = body.first_name ?? existing?.first_name;
  const last_name = body.last_name ?? existing?.last_name;
  if (first_name && !NAME_RE.test(first_name)) errors.first_name = NAME_REASON;
  if (last_name && !NAME_RE.test(last_name)) errors.last_name = NAME_REASON;
  const email = body.email ?? existing?.email;
  if (email !== undefined && !emailValid(email)) errors.email = EMAIL_REASON;
  const mobile = body.mobile ?? existing?.mobile;
  if (mobile && !MOBILE_RE.test(mobile)) errors.mobile = MOBILE_REASON;
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    validate(req.body, { isCreate: true });
    const { first_name, last_name, email, mobile, vendor_id } = req.body;
    const vendor = await one(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendor_id]);
    if (!vendor) throw new ValidationError('vendor_id: must reference an existing, active vendor', { vendor_id: 'must reference an existing, active vendor' });
    const idx = await nextIndex('contact');
    const { rows } = await pool.query(
      `INSERT INTO contacts (contact_index, first_name, last_name, email, mobile, vendor_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [idx, first_name, last_name, email, mobile || null, vendor_id]
    );
    await logChange('Contact', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    validate(req.body, { isCreate: false, existing });
    if (req.body.vendor_id) {
      const v = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
      if (!v) throw new ValidationError('vendor_id: must reference an existing, active vendor', { vendor_id: 'must reference an existing, active vendor' });
    }
    const fields = ['first_name', 'last_name', 'email', 'mobile', 'vendor_id'];
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
      `UPDATE contacts SET ${sets.join(', ')} WHERE contact_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('Contact', existing.contact_index, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    await pool.query(`UPDATE contacts SET deleted_at = NOW() WHERE contact_id = $1`, [id]);
    await logChange('Contact', existing.contact_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
