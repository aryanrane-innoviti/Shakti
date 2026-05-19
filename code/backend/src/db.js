import pg from 'pg';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(resolve(config.backupDir), { recursive: true });
mkdirSync(resolve(config.uploadDir), { recursive: true });

async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  const admin = new Pool({ connectionString: config.pgAdminUrl, max: 1 });
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rows.length) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

let _backupPool = null;
export function getBackupPool() {
  if (!config.backupDatabaseUrl) {
    const err = new Error('BACKUP_DATABASE_URL is not configured');
    err.code = 'BACKUP_DB_DISABLED';
    throw err;
  }
  if (!_backupPool) {
    _backupPool = new Pool({ connectionString: config.backupDatabaseUrl, max: 4 });
  }
  return _backupPool;
}

export async function query(text, params) {
  return pool.query(text, params);
}

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function initDb() {
  await ensureDatabase();
  const schemaPath = join(__dirname, 'migrations', '001_init.sql');
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
  }
}
