import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { ValidationError } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await many(`SELECT * FROM vendor_types WHERE deleted_at IS NULL ORDER BY vendor_type_id`));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(`SELECT * FROM vendor_types WHERE vendor_type_id = $1 AND deleted_at IS NULL`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 50)
      throw new ValidationError('name: must be 1–50 characters', { name: 'must be 1–50 characters' });
    const dup = await one(`SELECT 1 FROM vendor_types WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`, [name]);
    if (dup) return res.status(409).json({ error: 'name_already_exists' });
    const { rows } = await pool.query(
      `INSERT INTO vendor_types (name, is_seed) VALUES ($1, FALSE) RETURNING *`,
      [name]
    );
    await logChange('VendorType', rows[0].vendor_type_id, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM vendor_types WHERE vendor_type_id = $1 AND deleted_at IS NULL`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const dependents = await many(
      `SELECT vendor_id, company_name FROM vendors WHERE vendor_type_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (dependents.length) return res.status(409).json({ error: 'in_use', dependents });
    await pool.query(`DELETE FROM vendor_types WHERE vendor_type_id = $1`, [id]);
    await logChange('VendorType', id, req.session, 'HardDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
