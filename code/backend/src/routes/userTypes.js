import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { LABEL_RE, ValidationError } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT user_type_id, code, label, is_seed, is_immutable, created_at, updated_at
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
    const { code, label } = req.body || {};
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
      `INSERT INTO user_types (code, label, is_seed, is_immutable)
         VALUES ($1, $2, FALSE, FALSE) RETURNING *`,
      [upper, label]
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
    const { label } = req.body || {};
    if (label === undefined) return res.json(existing);
    if (!LABEL_RE.test(label))
      throw new ValidationError(
        'label: must be 1–50 characters, ASCII letters/digits/space/hyphen only',
        { label: 'must be 1–50 characters, ASCII letters/digits/space/hyphen only' }
      );
    const { rows } = await pool.query(
      `UPDATE user_types SET label = $1, updated_at = NOW() WHERE user_type_id = $2 RETURNING *`,
      [label, id]
    );
    await logChange('UserType', id, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
