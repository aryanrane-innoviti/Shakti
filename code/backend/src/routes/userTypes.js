import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { LABEL_RE, ValidationError } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT user_type_id, code, label, is_seed, is_immutable, location_eligible, created_at, updated_at
         FROM user_types WHERE deleted_at IS NULL ORDER BY user_type_id`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT * FROM user_types WHERE user_type_id = $1 AND deleted_at IS NULL`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const { code, label, location_eligible } = req.body || {};
    {
      const missing = {};
      if (!code) missing.code = 'required';
      if (!label) missing.label = 'required';
      if (Object.keys(missing).length) {
        const summary = Object.entries(missing).map(([f, r]) => `${f}: ${r}`).join(' | ');
        throw new ValidationError(summary, missing);
      }
    }
    if (!LABEL_RE.test(label))
      throw new ValidationError(
        'label: must be 1–50 characters, ASCII letters/digits/space/hyphen only',
        { label: 'must be 1–50 characters, ASCII letters/digits/space/hyphen only' }
      );
    const upper = String(code).toUpperCase();
    const dup = await one(`SELECT 1 FROM user_types WHERE code = $1`, [upper]);
    if (dup) return res.status(409).json({ error: 'code_already_exists' });
    const { rows } = await pool.query(
      `INSERT INTO user_types (code, label, is_seed, is_immutable, location_eligible)
         VALUES ($1, $2, FALSE, FALSE, $3) RETURNING *`,
      [upper, label, !!location_eligible]
    );
    await logChange('UserType', rows[0].user_type_id, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(
      `SELECT * FROM user_types WHERE user_type_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.is_immutable) return res.status(409).json({ error: 'immutable_user_type' });
    const { label, location_eligible } = req.body || {};

    const sets = [];
    const params = [];
    if (label !== undefined) {
      if (!LABEL_RE.test(label))
        throw new ValidationError(
          'label: must be 1–50 characters, ASCII letters/digits/space/hyphen only',
          { label: 'must be 1–50 characters, ASCII letters/digits/space/hyphen only' }
        );
      params.push(label); sets.push(`label = $${params.length}`);
    }
    if (location_eligible !== undefined) {
      // location_eligible is fixed for the eight seeded types; editable only on custom types.
      if (existing.is_seed) return res.status(409).json({ error: 'location_eligible_fixed_for_seed_type' });
      params.push(!!location_eligible); sets.push(`location_eligible = $${params.length}`);
    }
    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE user_types SET ${sets.join(', ')} WHERE user_type_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('UserType', id, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
