import { Router } from 'express';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { many, one } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../lib/auth.js';

const router = Router();
const backupDir = resolve(config.backupDir);

router.get('/', requireAuth, requireRole('SA', 'ADMIN'), async (req, res, next) => {
  try {
    const [
      users, vendors, contacts, locations, skus,
      user_types, vendor_types, sku_types,
      recent_changes,
    ] = await Promise.all([
      one(`SELECT
             COUNT(*)::int AS total,
             SUM(CASE WHEN status = 'Active'   THEN 1 ELSE 0 END)::int AS active,
             SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END)::int AS inactive
           FROM users WHERE deleted_at IS NULL`),
      one(`SELECT
             COUNT(*)::int AS total,
             SUM(CASE WHEN status = 'Active'   THEN 1 ELSE 0 END)::int AS active,
             SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END)::int AS inactive
           FROM vendors WHERE deleted_at IS NULL`),
      one(`SELECT COUNT(*)::int AS total FROM contacts WHERE deleted_at IS NULL`),
      one(`SELECT COUNT(*)::int AS total FROM locations WHERE deleted_at IS NULL`),
      one(`SELECT
             COUNT(*)::int AS total,
             SUM(CASE WHEN status = 'Active'   THEN 1 ELSE 0 END)::int AS active,
             SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END)::int AS inactive
           FROM skus WHERE deleted_at IS NULL`),
      one(`SELECT COUNT(*)::int AS total FROM user_types WHERE deleted_at IS NULL`),
      one(`SELECT COUNT(*)::int AS total FROM vendor_types WHERE deleted_at IS NULL`),
      one(`SELECT COUNT(*)::int AS total FROM sku_types WHERE deleted_at IS NULL`),
      many(`SELECT change_log_id, object_type, object_id, action, actor_user_index, occurred_at
              FROM change_log
              ORDER BY occurred_at DESC
              LIMIT 8`),
    ]);

    // Backups — SA only
    let backups = null;
    if (req.session.user_type_code === 'SA' && existsSync(backupDir)) {
      const files = readdirSync(backupDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => {
          const s = statSync(join(backupDir, f));
          return { name: f, size: s.size, mtime: s.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
      backups = {
        count: files.length,
        latest_at: files[0]?.mtime || null,
        latest_name: files[0]?.name || null,
      };
    }

    res.json({
      role: req.session.user_type_code,
      users, vendors, contacts, locations, skus,
      user_types, vendor_types, sku_types,
      backups,
      recent_changes,
    });
  } catch (e) { next(e); }
});

export default router;
