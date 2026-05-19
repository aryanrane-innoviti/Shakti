import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { ValidationError } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await many(`SELECT * FROM sku_types WHERE deleted_at IS NULL ORDER BY sku_type_id`));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(`SELECT * FROM sku_types WHERE sku_type_id = $1 AND deleted_at IS NULL`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, serial_eligible = false } = req.body || {};
    if (!name || name.length < 1 || name.length > 60)
      throw new ValidationError('name: must be 1–60 characters', { name: 'must be 1–60 characters' });
    const dup = await one(`SELECT 1 FROM sku_types WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`, [name]);
    if (dup) return res.status(409).json({ error: 'name_already_exists' });
    const { rows } = await pool.query(
      `INSERT INTO sku_types (name, serial_eligible, is_seed) VALUES ($1, $2, FALSE) RETURNING *`,
      [name, !!serial_eligible]
    );
    await logChange('SKUType', rows[0].sku_type_id, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM sku_types WHERE sku_type_id = $1 AND deleted_at IS NULL`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (req.body.serial_eligible !== undefined)
      throw new ValidationError('serial_eligible: cannot be changed after creation', { serial_eligible: 'cannot be changed after creation' });
    if (req.body.name === undefined) return res.json(existing);
    if (req.body.name.length < 1 || req.body.name.length > 60)
      throw new ValidationError('name: must be 1–60 characters', { name: 'must be 1–60 characters' });
    const { rows } = await pool.query(
      `UPDATE sku_types SET name = $1, updated_at = NOW() WHERE sku_type_id = $2 RETURNING *`,
      [req.body.name, id]
    );
    await logChange('SKUType', id, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// SKU types are non-deletable by product decision. No DELETE endpoint is exposed;
// attempts return 404 from the Express router.

export default router;
