import { Router } from 'express';
import { pool, one, withTransaction } from '../db.js';
import { config } from '../config.js';
import {
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  newToken,
  hoursFromNow,
  requireAuth,
  requireRole,
} from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const generic = { error: 'Invalid credentials' };
    if (!email || !password) return res.status(401).json(generic);
    const user = await one(
      `SELECT user_id, user_index, email, password_hash, status
         FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email]
    );
    if (!user) return res.status(401).json(generic);
    if (user.status !== 'Active') return res.status(401).json(generic);
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json(generic);
    const token = await createSession(user.user_id);
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE user_id = $1`, [user.user_id]);
    res.json({ token });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.session.token);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, (req, res) => {
  // attachInitialSetupFlag (global middleware, server.js) already ran the
  // ADMIN-existence query for this request and stored it on req.admin_exists —
  // reuse it instead of issuing the identical query a second time.
  res.json({
    user_id: req.session.user_id,
    user_index: req.session.user_index,
    email: req.session.email,
    first_name: req.session.first_name,
    last_name: req.session.last_name,
    user_type_code: req.session.user_type_code,
    user_type_label: req.session.user_type_label,
    initial_setup_required:
      req.session.user_type_code === 'SA' && !req.admin_exists,
  });
});

router.post(
  '/password-reset/url/:user_id',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const targetId = Number(req.params.user_id);
      const user = await one(
        `SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
        [targetId]
      );
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      await pool.query(
        `UPDATE password_resets SET invalidated_at = NOW()
          WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [targetId]
      );
      const token = newToken();
      await pool.query(
        `INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)`,
        [token, targetId, hoursFromNow(config.resetTtlHours)]
      );
      res.json({
        token,
        expires_in_hours: config.resetTtlHours,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/password-reset/consume', async (req, res, next) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token || !new_password)
      return res.status(400).json({ error: 'missing_fields' });
    const row = await one(
      `SELECT token, user_id, expires_at, consumed_at, invalidated_at
         FROM password_resets WHERE token = $1`,
      [token]
    );
    if (!row) return res.status(404).json({ error: 'link_invalid' });
    if (row.consumed_at) return res.status(410).json({ error: 'link_already_used' });
    if (row.invalidated_at) return res.status(410).json({ error: 'link_invalid' });
    if (new Date(row.expires_at) < new Date())
      return res.status(410).json({ error: 'link_expired' });
    const hash = hashPassword(new_password);
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password_hash = $1 WHERE user_id = $2`, [hash, row.user_id]);
      await client.query(`UPDATE password_resets SET consumed_at = NOW() WHERE token = $1`, [token]);
    });
    const u = await one(
      `SELECT user_id, user_index FROM users WHERE user_id = $1`,
      [row.user_id]
    );
    await logChange('User', u.user_index, u, 'Update');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
