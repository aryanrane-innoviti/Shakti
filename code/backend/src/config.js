import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  saEmail: process.env.SA_EMAIL || 'superadmin@innoviti.local',
  saPassword: process.env.SA_PASSWORD || 'ChangeMe!Boot',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  resetTtlHours: Number(process.env.RESET_TTL_HOURS || 24),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://Aryan.rane:1234@localhost:5432/shakti',
  pgAdminUrl:
    process.env.PG_ADMIN_URL ||
    'postgresql://Aryan.rane:1234@localhost:5432/postgres',
  // Separate Postgres for application-level JSONB snapshots — needed because
  // Railway free-tier Postgres ships without pg_dump/pg_restore. Leave unset to
  // disable the backup endpoints entirely.
  backupDatabaseUrl: process.env.BACKUP_DATABASE_URL || '',
  backupDir: process.env.BACKUP_DIR || './backups',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  pincodeApiUrl: process.env.PINCODE_API_URL || 'https://api.postalpincode.in/pincode/',
  pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
  pgRestorePath: process.env.PG_RESTORE_PATH || 'psql',
};
