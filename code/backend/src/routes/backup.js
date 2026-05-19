import { Router } from 'express';
import { pool, getBackupPool } from '../db.js';
import { requireAuth, requireRole } from '../lib/auth.js';

const router = Router();

/* ============================================================================
 * LEGACY: pg_dump / psql restore (kept for reference; commented out)
 * ----------------------------------------------------------------------------
 * Disabled because Railway free-tier Postgres ships without the pg_dump and
 * psql binaries on the app container, so spawn() can't find them. The new
 * implementation below uses application-level JSONB snapshots written to a
 * separate backup database.
 *
 * import { resolve, join, basename } from 'node:path';
 * import { readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
 * import { spawn } from 'node:child_process';
 * import { config } from '../config.js';
 *
 * const backupDir = resolve(config.backupDir);
 *
 * function safeName(name) {
 *   return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
 * }
 * function timestamp() {
 *   return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
 * }
 *
 * function pgEnv() {
 *   const url = new URL(config.databaseUrl);
 *   return {
 *     PGHOST: url.hostname,
 *     PGPORT: url.port || '5432',
 *     PGUSER: decodeURIComponent(url.username),
 *     PGPASSWORD: decodeURIComponent(url.password),
 *     PGDATABASE: url.pathname.replace(/^\//, ''),
 *   };
 * }
 *
 * function runPgDump(targetPath) {
 *   return new Promise((res, rej) => {
 *     const env = { ...process.env, ...pgEnv() };
 *     const args = ['--no-owner', '--no-privileges', '--clean', '--if-exists', '-f', targetPath];
 *     const child = spawn(config.pgDumpPath, args, { env });
 *     let err = '';
 *     child.stderr.on('data', (d) => (err += d.toString()));
 *     child.on('close', (code) => (code === 0 ? res() : rej(new Error(`pg_dump exit ${code}: ${err}`))));
 *     child.on('error', rej);
 *   });
 * }
 *
 * function runPgRestore(sourcePath) {
 *   return new Promise((res, rej) => {
 *     const env = { ...process.env, ...pgEnv() };
 *     const args = ['-v', 'ON_ERROR_STOP=1', '-f', sourcePath];
 *     const child = spawn(config.pgRestorePath, args, { env });
 *     let err = '';
 *     child.stderr.on('data', (d) => (err += d.toString()));
 *     child.on('close', (code) => (code === 0 ? res() : rej(new Error(`psql exit ${code}: ${err}`))));
 *     child.on('error', rej);
 *   });
 * }
 *
 * router.get('/', requireAuth, requireRole('SA'), (req, res) => {
 *   const files = readdirSync(backupDir)
 *     .filter((f) => f.endsWith('.sql'))
 *     .map((f) => {
 *       const s = statSync(join(backupDir, f));
 *       return { name: f, size: s.size, created_at: s.mtime.toISOString() };
 *     })
 *     .sort((a, b) => b.created_at.localeCompare(a.created_at));
 *   res.json(files);
 * });
 *
 * router.post('/', requireAuth, requireRole('SA'), async (req, res, next) => {
 *   try {
 *     const { filename } = req.body || {};
 *     const base = safeName(filename || `manual-${timestamp()}`);
 *     const name = base.endsWith('.sql') ? base : `${base}.sql`;
 *     const target = join(backupDir, name);
 *     await runPgDump(target);
 *     res.json({ name, path: target });
 *   } catch (e) { next(e); }
 * });
 *
 * router.post('/restore', requireAuth, requireRole('SA'), async (req, res, next) => {
 *   try {
 *     const { filename } = req.body || {};
 *     if (!filename) return res.status(400).json({ error: 'filename_required' });
 *     const source = join(backupDir, basename(filename));
 *     if (!existsSync(source)) return res.status(404).json({ error: 'backup_not_found' });
 *     await runPgRestore(source);
 *     res.json({ ok: true, restored_from: source });
 *   } catch (e) { next(e); }
 * });
 *
 * router.delete('/:name', requireAuth, requireRole('SA'), (req, res) => {
 *   const name = basename(req.params.name);
 *   const target = join(backupDir, name);
 *   if (!existsSync(target)) return res.status(404).json({ error: 'not_found' });
 *   unlinkSync(target);
 *   res.json({ ok: true });
 * });
 *
 * export async function takeDailySnapshot() {
 *   const name = `daily-${timestamp()}.sql`;
 *   const target = join(backupDir, name);
 *   await runPgDump(target);
 *   return target;
 * }
 * ========================================================================== */

// Parent-first order for restore (FKs in 001_init.sql). Tables not in this
// list are NOT snapshotted — add new tables here when the schema grows.
const SNAPSHOT_TABLES = [
  'user_types',
  'vendor_types',
  'sku_types',
  'terminal_parent_skus',
  'vendors',
  'users',
  'contacts',
  'skus',
  'sku_vendor_assocs',
  'locations',
  'change_log',
  'sessions',
  'password_resets',
  'counters',
];

// SERIAL/BIGSERIAL columns whose sequence must be reset after explicit inserts.
const SERIAL_COLS = {
  user_types: 'user_type_id',
  vendor_types: 'vendor_type_id',
  sku_types: 'sku_type_id',
  terminal_parent_skus: 'parent_sku_id',
  vendors: 'vendor_id',
  users: 'user_id',
  contacts: 'contact_id',
  skus: 'sku_id',
  sku_vendor_assocs: 'sku_vendor_assoc_id',
  locations: 'location_id',
  change_log: 'change_log_id',
};

function safeName(name) {
  return String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}
function timestamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
}

let _schemaReady = false;
async function ensureBackupSchema(bp) {
  if (_schemaReady) return;
  await bp.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      snapshot_id  BIGSERIAL PRIMARY KEY,
      name         TEXT NOT NULL UNIQUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      table_count  INTEGER NOT NULL DEFAULT 0,
      row_count    BIGINT NOT NULL DEFAULT 0,
      size_bytes   BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS snapshot_tables (
      snapshot_id  BIGINT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
      table_name   TEXT NOT NULL,
      row_count    INTEGER NOT NULL,
      payload      JSONB NOT NULL,
      PRIMARY KEY (snapshot_id, table_name)
    );
  `);
  _schemaReady = true;
}

async function createSnapshot(displayName) {
  const bp = getBackupPool();
  await ensureBackupSchema(bp);

  const base = safeName(displayName || `manual-${timestamp()}`);

  // Read every table inside one REPEATABLE READ transaction so the snapshot
  // sees a single point-in-time view of the database.
  const live = await pool.connect();
  let totalRows = 0;
  let totalBytes = 0;
  const blobs = [];
  try {
    await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const t of SNAPSHOT_TABLES) {
      const { rows } = await live.query(
        `SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) AS payload,
                COUNT(*)::int AS n
           FROM "${t}" x`
      );
      const payload = rows[0].payload || [];
      const json = JSON.stringify(payload);
      totalRows += rows[0].n;
      totalBytes += Buffer.byteLength(json, 'utf8');
      blobs.push({ table: t, n: rows[0].n, json });
    }
    await live.query('COMMIT');
  } catch (e) {
    await live.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    live.release();
  }

  const bpc = await bp.connect();
  try {
    await bpc.query('BEGIN');
    const ins = await bpc.query(
      `INSERT INTO snapshots (name, table_count, row_count, size_bytes)
       VALUES ($1, $2, $3, $4)
       RETURNING snapshot_id, name, created_at, size_bytes, row_count`,
      [base, SNAPSHOT_TABLES.length, totalRows, totalBytes]
    );
    const snapshotId = ins.rows[0].snapshot_id;
    for (const b of blobs) {
      await bpc.query(
        `INSERT INTO snapshot_tables (snapshot_id, table_name, row_count, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [snapshotId, b.table, b.n, b.json]
      );
    }
    await bpc.query('COMMIT');
    return ins.rows[0];
  } catch (e) {
    await bpc.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    bpc.release();
  }
}

async function restoreSnapshot(name) {
  const bp = getBackupPool();
  await ensureBackupSchema(bp);

  const snap = await bp.query(`SELECT snapshot_id FROM snapshots WHERE name = $1`, [name]);
  if (!snap.rows.length) {
    const err = new Error('snapshot_not_found');
    err.code = 'SNAPSHOT_NOT_FOUND';
    throw err;
  }
  const snapshotId = snap.rows[0].snapshot_id;

  // Pull each table's payload as a string so we can hand it straight to
  // jsonb_populate_recordset on the live DB without re-serializing.
  const { rows: blobs } = await bp.query(
    `SELECT table_name, payload::text AS payload FROM snapshot_tables WHERE snapshot_id = $1`,
    [snapshotId]
  );
  const byTable = Object.fromEntries(blobs.map((b) => [b.table_name, b.payload]));

  const live = await pool.connect();
  try {
    await live.query('BEGIN');
    const list = SNAPSHOT_TABLES.map((t) => `"${t}"`).join(', ');
    await live.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

    for (const t of SNAPSHOT_TABLES) {
      const payload = byTable[t];
      if (!payload || payload === '[]') continue;
      await live.query(
        `INSERT INTO "${t}"
         SELECT * FROM jsonb_populate_recordset(NULL::"${t}", $1::jsonb)`,
        [payload]
      );
      const col = SERIAL_COLS[t];
      if (col) {
        await live.query(
          `SELECT setval(
             pg_get_serial_sequence('"${t}"', '${col}'),
             COALESCE((SELECT MAX("${col}") FROM "${t}"), 1),
             EXISTS (SELECT 1 FROM "${t}")
           )`
        );
      }
    }
    await live.query('COMMIT');
  } catch (e) {
    await live.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    live.release();
  }
}

router.get('/', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const bp = getBackupPool();
    await ensureBackupSchema(bp);
    const { rows } = await bp.query(
      `SELECT name, size_bytes, created_at, row_count
         FROM snapshots ORDER BY created_at DESC`
    );
    res.json(
      rows.map((r) => ({
        name: r.name,
        size: Number(r.size_bytes),
        created_at: r.created_at,
        row_count: Number(r.row_count),
      }))
    );
  } catch (e) {
    if (e.code === 'BACKUP_DB_DISABLED') {
      return res.status(503).json({ error: 'backup_db_not_configured' });
    }
    next(e);
  }
});

router.post('/', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const { filename } = req.body || {};
    const out = await createSnapshot(filename);
    res.json({ name: out.name, size: Number(out.size_bytes), created_at: out.created_at });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'snapshot_name_exists' });
    }
    if (e.code === 'BACKUP_DB_DISABLED') {
      return res.status(503).json({ error: 'backup_db_not_configured' });
    }
    next(e);
  }
});

router.post('/restore', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename_required' });
    await restoreSnapshot(filename);
    res.json({
      ok: true,
      restored_from: filename,
      note: 'Database restored. Active sessions were invalidated — sign in again.',
    });
  } catch (e) {
    if (e.code === 'SNAPSHOT_NOT_FOUND') return res.status(404).json({ error: 'backup_not_found' });
    if (e.code === 'BACKUP_DB_DISABLED') {
      return res.status(503).json({ error: 'backup_db_not_configured' });
    }
    next(e);
  }
});

router.delete('/:name', requireAuth, requireRole('SA'), async (req, res, next) => {
  try {
    const bp = getBackupPool();
    await ensureBackupSchema(bp);
    const r = await bp.query(`DELETE FROM snapshots WHERE name = $1`, [req.params.name]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'BACKUP_DB_DISABLED') {
      return res.status(503).json({ error: 'backup_db_not_configured' });
    }
    next(e);
  }
});

export async function takeDailySnapshot() {
  try {
    return await createSnapshot(`daily-${timestamp()}`);
  } catch (e) {
    if (e.code === 'BACKUP_DB_DISABLED') return null;
    throw e;
  }
}

export default router;
