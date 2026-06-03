import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, one } from '../db.js';
import { config } from '../config.js';

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600_000);
}

export async function createSession(userId) {
  const token = newToken();
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, hoursFromNow(config.sessionTtlHours)]
  );
  return token;
}

export async function destroySession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function loadSession(token) {
  if (!token) return null;
  const row = await one(
    `SELECT s.token, s.expires_at,
            u.user_id, u.user_index, u.email, u.first_name, u.last_name,
            u.status, u.vendor_id,
            ut.code AS user_type_code, ut.label AS user_type_label, ut.user_type_id
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
       JOIN user_types ut ON ut.user_type_id = u.user_type_id
      WHERE s.token = $1`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await destroySession(token);
    return null;
  }
  return row;
}

export async function verifyPassword(plaintext, hash) {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

export function hashPassword(plaintext) {
  return bcrypt.hashSync(plaintext, 10);
}

export async function authMiddleware(req, res, next) {
  try {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    req.session = await loadSession(token);
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

export function requireRole(...codes) {
  return (req, res, next) => {
    if (!req.session) return res.status(401).json({ error: 'unauthenticated' });
    if (!codes.includes(req.session.user_type_code)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

// Write access for operational (Section 1) objects. Both SA and Admin are
// permitted — every such write endpoint is specified as "SA or Admin"
// (task1.md §1.6, §3–§7). SA-exclusive routes (User Types, Backups) use
// requireRole('SA') instead; this guard is not the place to exclude SA.
// Name kept as requireAdmin to avoid churn across ~14 route files.
export function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthenticated' });
  if (['ADMIN', 'SA'].includes(req.session.user_type_code)) return next();
  return res.status(403).json({ error: 'admin_only' });
}

// Read-only access: ADMIN can read everything; SA can read everything for visibility,
// but writes are gated separately.
export function requireAdminRead(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthenticated' });
  if (['ADMIN', 'SA'].includes(req.session.user_type_code)) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// ASO-only access. Used for the Phase 3 audit-session routes that only an
// ASO may invoke (start / scan / table mutations / complete / cancel). SA
// and Admin get read-only oversight via separate routes; they do NOT pass
// through this guard.
export function requireAso(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthenticated' });
  if (req.session.user_type_code === 'ASO') return next();
  return res.status(403).json({ error: 'forbidden' });
}

export async function attachInitialSetupFlag(req, res, next) {
  try {
    if (!req.session) return next();
    const row = await one(
      `SELECT 1 AS x FROM users u
         JOIN user_types ut ON ut.user_type_id = u.user_type_id
        WHERE ut.code = 'ADMIN' AND u.deleted_at IS NULL
        LIMIT 1`
    );
    req.admin_exists = !!row;
    req.initial_setup_in_progress =
      req.session.user_type_code === 'SA' && !row;
    next();
  } catch (e) {
    next(e);
  }
}
