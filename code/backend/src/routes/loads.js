import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pool, one, many } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, requireAdminRead } from '../lib/auth.js';
import { parseFile, detectFormat, CsvError } from '../lib/load/parsers.js';
import { getKind, publicTargetFields } from '../lib/load/kinds.js';
import { suggestMapping, validateMapping, splitMapping } from '../lib/load/mapping.js';
import { commitLoad } from '../lib/load/commit.js';

const router = Router();

const LOADS_DIR = resolve(config.uploadDir, 'loads');
mkdirSync(LOADS_DIR, { recursive: true });

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_ROWS = 500000;

const ACCEPTED_EXT = new Set(['.csv', '.xlsx', '.xls']);
const ACCEPTED_MIME = new Set([
  'text/csv', 'application/csv', 'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  dest: resolve(config.uploadDir, 'tmp'),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if (!ACCEPTED_EXT.has(ext) && !ACCEPTED_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error('only CSV or XLSX allowed'), { status: 415 }));
    }
    cb(null, true);
  },
});

// URL slug → kinds.js key
const SLUG_TO_KIND = {
  'payment-terminal': 'payment_terminal',
  'sim-card': 'sim_card',
  'base-station': 'base_station',
};

function resolveKindFromSlug(slug, res) {
  const key = SLUG_TO_KIND[slug];
  if (!key) {
    res.status(404).json({ error: 'unknown_kind' });
    return null;
  }
  return getKind(key);
}

// ---- GET /loads/:slug/template ----------------------------------------
// Returns a CSV with the canonical header row (one column per
// non-server-set target field). Users download, fill in their data,
// then upload. Works for any authenticated Admin/SA.
router.get('/:slug/template', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const kind = resolveKindFromSlug(req.params.slug, res);
    if (!kind) return;
    const headers = kind.targetFields.filter((t) => !t.server_set).map((t) => t.field);
    const csv = headers.join(',') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}-template.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ---- POST /loads/:slug/preview ----------------------------------------
// Stores the upload to disk and parses headers. NO DB row is created at
// this stage — the load_attempts row is only created when commit runs.
// File-level rejections (bad CSV, too many rows) wipe the file and
// return an HTTP error with no DB side-effect.
router.post(
  '/:slug/preview',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const kind = resolveKindFromSlug(req.params.slug, res);
      if (!kind) return;
      if (!req.file) return res.status(400).json({ error: 'file_required' });

      const attempt_id = randomUUID();
      const origName = req.file.originalname || 'upload.csv';
      const extLower = extname(origName).toLowerCase();
      const ext = (extLower === '.xlsx' || extLower === '.xls') ? '.xlsx' : '.csv';
      const storedPath = join(LOADS_DIR, `${attempt_id}${ext}`);
      renameSync(req.file.path, storedPath);

      let parsed;
      try {
        parsed = parseFile(readFileSync(storedPath), origName);
      } catch (e) {
        try { unlinkSync(storedPath); } catch {}
        if (e instanceof CsvError) return res.status(422).json({ error: 'file_invalid', message: e.message });
        throw e;
      }

      if (parsed.rows.length > MAX_ROWS) {
        try { unlinkSync(storedPath); } catch {}
        return res.status(422).json({ error: 'too_many_rows', max_rows: MAX_ROWS, rows: parsed.rows.length });
      }

      res.json({
        attempt_id,
        file_name: origName,
        format: detectFormat(origName),
        kind: req.params.slug,
        headers: parsed.headers,
        suggested_mapping: suggestMapping(parsed.headers, kind.targetFields),
        target_fields: publicTargetFields(kind),
        rows_total: parsed.rows.length,
      });
    } catch (e) {
      if (e.status === 415) return res.status(415).json({ error: 'only CSV or XLSX files are accepted' });
      if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', max_bytes: MAX_BYTES });
      next(e);
    }
  }
);

// ---- DELETE /loads/:slug/preview/:draftId -----------------------------
// Removes a preview file when the user cancels without committing. The
// kind slug is in the path for API symmetry only; we look up by id.
router.delete('/:slug/preview/:draftId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const draftId = req.params.draftId;
    for (const e of ['.csv', '.xlsx']) {
      const p = join(LOADS_DIR, `${draftId}${e}`);
      if (existsSync(p)) { try { unlinkSync(p); } catch {} }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- POST /loads/:slug/commit -----------------------------------------
// Creates the load_attempts row at this point — the first DB write of
// the load workflow — then runs the commit pipeline.
router.post(
  '/:slug/commit',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const kind = resolveKindFromSlug(req.params.slug, res);
      if (!kind) return;
      const { attempt_id, mapping, file_name } = req.body || {};
      if (!attempt_id) return res.status(400).json({ error: 'attempt_id_required' });

      // Locate the preview file on disk
      let storedPath = null;
      for (const e of ['.csv', '.xlsx']) {
        const p = join(LOADS_DIR, `${attempt_id}${e}`);
        if (existsSync(p)) { storedPath = p; break; }
      }
      if (!storedPath) return res.status(410).json({ error: 'file_missing' });

      const origName = file_name || 'upload';

      let parsed;
      try {
        parsed = parseFile(readFileSync(storedPath), origName);
      } catch (e) {
        if (e instanceof CsvError) return res.status(422).json({ error: 'file_invalid', message: e.message });
        throw e;
      }

      const issues = validateMapping(mapping, kind.targetFields, parsed.headers);
      if (issues.length) return res.status(422).json({ error: 'mapping_invalid', issues });

      const { effective, dropped } = splitMapping(mapping, kind.targetFields);
      const kindKey = SLUG_TO_KIND[req.params.slug];

      // First DB write of the journey. If a row already exists with this
      // id, the user double-clicked Load — return the existing summary.
      try {
        await pool.query(
          `INSERT INTO load_attempts
             (attempt_id, kind, user_id, user_index, file_name, stored_file_path, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Pending')`,
          [attempt_id, kindKey, req.session.user_id, req.session.user_index, origName, storedPath]
        );
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'attempt_already_committed' });
        throw e;
      }

      const summary = await commitLoad({
        kind,
        attempt: { attempt_id, file_name: origName },
        mapping: effective,
        rows: parsed.rows,
        actor: req.session,
        droppedTargets: dropped,
      });

      res.json(summary);
    } catch (e) {
      next(e);
    }
  }
);

// ---- GET /loads/attempts -----------------------------------------------
router.get('/attempts', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const { kind, status, user_id } = req.query;
    const where = [];
    const params = [];
    if (status)  { params.push(status);        where.push(`status = $${params.length}`); }
    if (kind)    { params.push(kind);          where.push(`kind = $${params.length}`); }
    if (user_id) { params.push(Number(user_id)); where.push(`user_id = $${params.length}`); }
    const sql = `
      SELECT a.*, u.first_name AS user_first_name, u.last_name AS user_last_name
        FROM load_attempts a
        LEFT JOIN users u ON u.user_id = a.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.started_at DESC, a.attempt_id DESC
       LIMIT 500`;
    res.json(await many(sql, params));
  } catch (e) { next(e); }
});

// ---- DELETE /loads/attempts/:id ---------------------------------------
// Removes one attempt, its load_errors (CASCADE), and the stored upload.
router.delete('/attempts/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const attempt = await one(
      `SELECT stored_file_path FROM load_attempts WHERE attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt) return res.status(404).json({ error: 'not_found' });
    if (attempt.stored_file_path && existsSync(attempt.stored_file_path)) {
      try { unlinkSync(attempt.stored_file_path); } catch {}
    }
    await pool.query(`DELETE FROM load_attempts WHERE attempt_id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- DELETE /loads/attempts -------------------------------------------
// Bulk clear. Without filters it wipes every attempt (and its files).
// Optional kind / status / user_id filters narrow the scope.
router.delete('/attempts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { kind, status, user_id } = req.query;
    const where = [];
    const params = [];
    if (kind)    { params.push(kind);          where.push(`kind = $${params.length}`); }
    if (status)  { params.push(status);        where.push(`status = $${params.length}`); }
    if (user_id) { params.push(Number(user_id)); where.push(`user_id = $${params.length}`); }
    const filesToDrop = await many(
      `SELECT stored_file_path FROM load_attempts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      params
    );
    for (const r of filesToDrop) {
      if (r.stored_file_path && existsSync(r.stored_file_path)) {
        try { unlinkSync(r.stored_file_path); } catch {}
      }
    }
    const result = await pool.query(
      `DELETE FROM load_attempts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      params
    );
    res.json({ ok: true, deleted: result.rowCount });
  } catch (e) { next(e); }
});

// ---- GET /loads/attempts/:id -------------------------------------------
// Returns the attempt summary plus the per-error-code count. The full
// error list is fetched on demand via /attempts/:id/errors.xlsx.
router.get('/attempts/:id', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const attempt = await one(
      `SELECT a.*, u.first_name AS user_first_name, u.last_name AS user_last_name
         FROM load_attempts a
         LEFT JOIN users u ON u.user_id = a.user_id
        WHERE a.attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt) return res.status(404).json({ error: 'not_found' });

    const counts = await many(
      `SELECT error_code, COUNT(*)::int AS n FROM load_errors
        WHERE attempt_id = $1 GROUP BY error_code ORDER BY n DESC`,
      [req.params.id]
    );
    const errors_by_code = Object.fromEntries(counts.map((c) => [c.error_code, c.n]));

    res.json({ ...attempt, errors_by_code });
  } catch (e) { next(e); }
});

// ---- GET /loads/attempts/:id/errors.xlsx ------------------------------
// Stream every load_error for the attempt as an XLSX. Safe for hundreds
// of thousands of rows because XLSX is compressed.
router.get('/attempts/:id/errors.xlsx', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const XLSX = await import('xlsx');
    const attempt = await one(
      `SELECT attempt_id, file_name, kind, rows_total, rows_loaded, rows_failed, status
         FROM load_attempts WHERE attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt) return res.status(404).json({ error: 'not_found' });
    const rows = await many(
      `SELECT row_number, error_code, error_message, raw_row
         FROM load_errors WHERE attempt_id = $1
         ORDER BY row_number, load_error_id`,
      [req.params.id]
    );
    const sheetRows = [
      ['Row', 'Error Code', 'Error Message', 'Raw Source Row'],
      ...rows.map((r) => [r.row_number, r.error_code, r.error_message, r.raw_row || '']),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    // Reasonable column widths
    ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 60 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const baseName = (attempt.file_name || 'load').replace(/\.(csv|xlsx?|XLS)$/i, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-errors.xlsx"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// ---- GET /loads/attempts/:id/file --------------------------------------
router.get('/attempts/:id/file', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const attempt = await one(
      `SELECT file_name, stored_file_path FROM load_attempts WHERE attempt_id = $1`,
      [req.params.id]
    );
    if (!attempt || !attempt.stored_file_path || !existsSync(attempt.stored_file_path)) {
      return res.status(404).json({ error: 'file_not_found' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${attempt.file_name}"`);
    res.sendFile(resolve(attempt.stored_file_path));
  } catch (e) { next(e); }
});

export default router;
