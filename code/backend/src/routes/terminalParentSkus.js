import { Router } from 'express';
import { pool, one, many } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { ValidationError } from '../lib/validate.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await many(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM skus s WHERE s.parent_sku_id = p.parent_sku_id) AS used_by_count
         FROM terminal_parent_skus p
        ORDER BY p.parent_sku_id`
    ));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(`SELECT * FROM terminal_parent_skus WHERE parent_sku_id = $1`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    if (!name || name.length < 1 || name.length > 100)
      throw new ValidationError('name: must be 1–100 characters', { name: 'must be 1–100 characters' });
    const dup = await one(`SELECT 1 FROM terminal_parent_skus WHERE LOWER(name) = LOWER($1)`, [name]);
    if (dup) return res.status(409).json({ error: 'name_already_exists' });
    const idx = await nextIndex('parent_sku');
    const { rows } = await pool.query(
      `INSERT INTO terminal_parent_skus (parent_sku_number, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [idx, name, description || null]
    );
    await logChange('TerminalParentSKU', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM terminal_parent_skus WHERE parent_sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      if (req.body.name.length < 1 || req.body.name.length > 100)
        throw new ValidationError('name: must be 1–100 characters', { name: 'must be 1–100 characters' });
      const dup = await one(
        `SELECT 1 FROM terminal_parent_skus WHERE LOWER(name) = LOWER($1) AND parent_sku_id <> $2`,
        [req.body.name, id]
      );
      if (dup) return res.status(409).json({ error: 'name_already_exists' });
      params.push(req.body.name);
      sets.push(`name = $${params.length}`);
    }
    if (req.body.description !== undefined) {
      params.push(req.body.description);
      sets.push(`description = $${params.length}`);
    }
    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE terminal_parent_skus SET ${sets.join(', ')} WHERE parent_sku_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('TerminalParentSKU', existing.parent_sku_number, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM terminal_parent_skus WHERE parent_sku_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const deps = await many(`SELECT sku_id, sku_number FROM skus WHERE parent_sku_id = $1`, [id]);
    if (deps.length) return res.status(409).json({ error: 'in_use', dependents: deps });
    await pool.query(`DELETE FROM terminal_parent_skus WHERE parent_sku_id = $1`, [id]);
    await logChange('TerminalParentSKU', existing.parent_sku_number, req.session, 'HardDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
