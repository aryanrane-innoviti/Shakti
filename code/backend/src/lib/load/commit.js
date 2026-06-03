import { pool, withTransaction, many } from '../../db.js';
import { logChange } from '../changeLog.js';

// Templates per task2.md §6.1. Placeholders {x} are substituted.
const MSG = {
  sku_not_found:        'SKU number in {row_number} of {file_name} not found in Shakti, create SKU part or correct file',
  vendor_sku_not_found: 'Vendor SKU number "{vendor_sku_number}" for owner {owner} in row {row_number} of {file_name} not found in Shakti — add the vendor SKU and link it to an Innoviti SKU of this type, or correct the file',
  owner_not_found:   'Owner in row {row_number} of file {file_name} not found in Shakti, create Owner or correct file',
  duplicate_index:   '{index_value} of {sku_number} in {row_number} of {file_name} already exists in Shakti, not loaded',
  required_missing:  "Required field '{field}' missing in row {row_number} of {file_name}",
  bad_format:        "Value '{raw_value}' for '{field}' in row {row_number} of {file_name} is not a valid {expected_type}",
  pick_list_invalid: "Value '{raw_value}' for '{field}' in row {row_number} of {file_name} is not one of: {allowed_values}",
};

function fmt(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (ctx[key] !== undefined ? String(ctx[key]) : `{${key}}`));
}

// Date parsing per task2.md §2: accept YYYY-MM-DD or DD/MM/YYYY. Otherwise bad_format.
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d) return s;
    return null;
  }
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d) {
      return `${y}-${m}-${d}`;
    }
    return null;
  }
  return null;
}

function val(row, effective, target) {
  const header = effective[target];
  if (!header) return '';
  const raw = row[header];
  return raw == null ? '' : String(raw).trim();
}

// Pre-resolve lookup tables so the per-row loop hits the DB minimally.
async function buildLookups(kind) {
  const vendors = await many(
    `SELECT vendor_id, company_name FROM vendors WHERE deleted_at IS NULL`
  );
  const vendorByName = new Map(vendors.map((v) => [v.company_name.toLowerCase(), v]));

  // Kinds matched by vendor SKU number resolve (owner vendor + vendor SKU
  // number) to one vendor SKU. A vendor SKU is loadable for this kind only if
  // it is linked to at least one Innoviti SKU of the kind's type. vendor SKU
  // numbers are unique per vendor, so the key resolves unambiguously.
  if (kind.matchField === 'vendor_sku_number') {
    const rows = await many(
      `SELECT DISTINCT vs.vendor_id, vs.vendor_sku_id, vs.vendor_sku_number
         FROM vendor_skus vs
         JOIN sku_vendor_links l ON l.vendor_sku_id = vs.vendor_sku_id AND l.deleted_at IS NULL
         JOIN skus s            ON s.sku_id = l.sku_id AND s.deleted_at IS NULL
         JOIN sku_types st      ON st.sku_type_id = s.sku_type_id
        WHERE st.name = $1 AND vs.deleted_at IS NULL`,
      [kind.requiredSkuTypeName]
    );
    // Key: vendor_id::vendor_sku_number(lower) → the one vendor SKU.
    const vendorSkuByOwner = new Map();
    for (const r of rows) {
      const key = `${r.vendor_id}::${String(r.vendor_sku_number).toLowerCase()}`;
      vendorSkuByOwner.set(key, {
        vendor_sku_id: r.vendor_sku_id,
        vendor_sku_number: r.vendor_sku_number,
      });
    }
    return { vendorByName, vendorSkuByOwner };
  }

  const skus = await many(
    `SELECT s.sku_id, s.sku_number, s.sku_name, s.description
       FROM skus s
       JOIN sku_types st ON st.sku_type_id = s.sku_type_id
      WHERE st.name = $1 AND s.deleted_at IS NULL`,
    [kind.requiredSkuTypeName]
  );
  const skuByNumber = new Map(skus.map((r) => [r.sku_number.toLowerCase(), r]));
  return { vendorByName, skuByNumber };
}

// Build the set of already-existing (anchor :: index-value) keys this file
// could collide with. Only the index values that actually appear in the file
// can ever be probed (validateRow checks existingIndex.has(`${anchorId}::${
// indexRaw.toLowerCase()}`)), so we fetch existing rows for just those values
// instead of materialising the entire (10k..1M-row) master table per commit.
async function existingIndexSet(kind, fileIdxValues) {
  if (!fileIdxValues.length) return new Set();
  const indexCol = kind.uniqueIndexLabel; // serial_number or sim_card_number
  // Vendor-SKU kinds are unique per vendor SKU; SIM Cards per Innoviti SKU.
  const anchorCol = kind.matchField === 'vendor_sku_number' ? 'vendor_sku_id' : 'sku_id';
  const rows = await many(
    `SELECT ${anchorCol} AS anchor, ${indexCol} AS idx
       FROM ${kind.tableName}
      WHERE deleted_at IS NULL AND lower(${indexCol}) = ANY($1)`,
    [fileIdxValues]
  );
  const set = new Set();
  for (const r of rows) set.add(`${r.anchor}::${String(r.idx).toLowerCase()}`);
  return set;
}

// Per-kind row validation + value resolution. Returns either { ok: true, values }
// or { ok: false, code, message }.
function validateRow({ kind, row, effective, lookups, fileName, indexSeenInFile, existingIndex }) {
  const ctx = { row_number: row.__row_number, file_name: fileName };

  // Owner (vendor) — Payment Terminal + Base Station. Resolved first
  // because vendor-SKU-number matching needs the owner to disambiguate.
  const ownerNeeded = kind.targetFields.some((t) => t.field === 'owner');
  let ownerVendor = null;
  let ownerRaw = '';
  if (ownerNeeded) {
    ownerRaw = val(row, effective, 'owner');
    if (!ownerRaw) {
      return error('required_missing', { ...ctx, field: 'owner' });
    }
    ownerVendor = lookups.vendorByName.get(ownerRaw.toLowerCase());
    if (!ownerVendor) {
      return error('owner_not_found', ctx);
    }
  }

  // Resolve the row's anchor. Payment Terminal / Base Station resolve
  // (owner vendor + vendor SKU number) to a vendor SKU; SIM Card resolves
  // directly to an Innoviti SKU by number.
  const byVendorSku = kind.matchField === 'vendor_sku_number';
  let resolved;
  if (byVendorSku) {
    const vskuRaw = val(row, effective, 'vendor_sku_number');
    if (!vskuRaw) {
      return error('required_missing', { ...ctx, field: 'vendor_sku_number' });
    }
    resolved = lookups.vendorSkuByOwner.get(`${ownerVendor.vendor_id}::${vskuRaw.toLowerCase()}`);
    if (!resolved) {
      return error('vendor_sku_not_found', { ...ctx, vendor_sku_number: vskuRaw, owner: ownerRaw });
    }
  } else {
    const skuRaw = val(row, effective, 'sku_number');
    if (!skuRaw) {
      return error('required_missing', { ...ctx, field: 'sku_number' });
    }
    resolved = lookups.skuByNumber.get(skuRaw.toLowerCase());
    if (!resolved) {
      return error('sku_not_found', ctx);
    }
  }
  // The anchor a unit is unique within: the vendor SKU for PT/BS, the
  // Innoviti SKU for SIM Card.
  const anchorId = byVendorSku ? resolved.vendor_sku_id : resolved.sku_id;
  const anchorLabel = byVendorSku ? resolved.vendor_sku_number : resolved.sku_number;

  // The "second" component of the unique index (serial_number or sim_card_number)
  const indexField = kind.uniqueIndexLabel;
  const indexRaw = val(row, effective, indexField);
  if (!indexRaw) {
    return error('required_missing', { ...ctx, field: indexField });
  }
  if (indexRaw.length > (indexField === 'sim_card_number' ? 50 : 100)) {
    return error('bad_format', {
      ...ctx, field: indexField, raw_value: indexRaw,
      expected_type: indexField === 'sim_card_number' ? 'string up to 50 chars' : 'string up to 100 chars',
    });
  }

  const indexKey = `${anchorId}::${indexRaw.toLowerCase()}`;
  if (existingIndex.has(indexKey) || indexSeenInFile.has(indexKey)) {
    return {
      ok: false, code: 'duplicate_index',
      message: fmt(MSG.duplicate_index, { ...ctx, index_value: indexRaw, sku_number: anchorLabel }),
    };
  }
  indexSeenInFile.add(indexKey);

  // Identifiers are always derived from the resolved record — never taken
  // from the file, so a wrong value in the file cannot slip through.
  // Description is taken from the file when supplied, falling back to the
  // Innoviti SKU's own description (SIM Card only) when the row leaves it blank.
  const fileDescription = val(row, effective, 'description');
  let values;
  if (byVendorSku) {
    // PT / BS: anchored to the vendor SKU. The Innoviti SKU(s) are derived
    // through sku_vendor_links, so no single sku_id is recorded.
    values = {
      vendor_sku_id: resolved.vendor_sku_id,
      vendor_sku_number_snapshot: resolved.vendor_sku_number,
      sku_description_snapshot: fileDescription || null,
      [indexField]: indexRaw,
    };
  } else {
    values = {
      sku_id: resolved.sku_id,
      sku_number_snapshot: resolved.sku_number,
      sku_name_snapshot: resolved.sku_name,
      sku_description_snapshot: fileDescription || resolved.description || null,
      [indexField]: indexRaw,
    };
  }

  if (ownerNeeded) {
    values.owner_vendor_id = ownerVendor.vendor_id;
  }

  // Date of Purchase (Payment Terminal + Base Station). Optional — always
  // written (NULL when absent) so every row of a kind has the same columns.
  const dateNeeded = kind.targetFields.some((t) => t.field === 'date_of_purchase');
  if (dateNeeded) {
    const dateRaw = val(row, effective, 'date_of_purchase');
    if (dateRaw) {
      const parsed = parseDate(dateRaw);
      if (!parsed) {
        return error('bad_format', {
          ...ctx, field: 'date_of_purchase', raw_value: dateRaw,
          expected_type: 'date (YYYY-MM-DD or DD/MM/YYYY)',
        });
      }
      values.date_of_purchase = parsed;
    } else {
      values.date_of_purchase = null;
    }
  }

  return { ok: true, values };

  function error(code, c) {
    return { ok: false, code, message: fmt(MSG[code], c) };
  }
}

// All inserts share the same column shape for a given kind, so compute it
// once per commit. PostgreSQL's per-statement parameter limit is 65535, so
// at ~10 cols per row we keep batches at 500 — comfortably under and small
// enough that a single batch failure doesn't lose huge swaths of work.
const INSERT_BATCH = 500;
const ERROR_BATCH = 1000;

function buildBulkInsertSql(kind, rowsToInsert, attempt_id) {
  // Discover the full column set from the first row's keys + the always-on
  // state and loaded_via_attempt_id columns. Every row contributes the same
  // shape because validateRow returns the same key set per kind.
  if (!rowsToInsert.length) return null;
  const baseCols = Object.keys(rowsToInsert[0].values);
  const cols = [...baseCols, 'state', 'loaded_via_attempt_id'];
  const params = [];
  const tuples = [];
  let p = 1;
  for (const item of rowsToInsert) {
    const placeholders = [];
    for (const c of baseCols) {
      placeholders.push(`$${p++}`);
      params.push(item.values[c] ?? null);
    }
    placeholders.push(`$${p++}`); params.push(kind.defaultState);
    placeholders.push(`$${p++}`); params.push(attempt_id);
    tuples.push(`(${placeholders.join(', ')})`);
  }
  const sql = `INSERT INTO ${kind.tableName} (${cols.join(', ')})
               VALUES ${tuples.join(', ')}
               RETURNING ${kind.pkColumn}`;
  return { sql, params };
}

async function bulkLogChange(client, objectType, ids, actor) {
  if (!ids.length) return;
  const params = [];
  const tuples = [];
  let p = 1;
  for (const id of ids) {
    tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(objectType, String(id), actor?.user_id ?? null, actor?.user_index ?? null, 'Create');
  }
  await client.query(
    `INSERT INTO change_log (object_type, object_id, actor_user_id, actor_user_index, action)
     VALUES ${tuples.join(', ')}`,
    params
  );
}

export async function commitLoad({ kind, attempt, mapping, rows, actor, droppedTargets }) {
  const lookups = await buildLookups(kind);
  // The duplicate check only ever probes the index values present in THIS file,
  // so collect them up-front (distinct, lower-cased) and fetch only matching
  // existing rows — never the whole master table.
  const idxHeader = mapping[kind.uniqueIndexLabel];
  const fileIdxValues = idxHeader
    ? [...new Set(
        rows
          .map((r) => (r[idxHeader] == null ? '' : String(r[idxHeader]).trim().toLowerCase()))
          .filter(Boolean)
      )]
    : [];
  const existingIndex = await existingIndexSet(kind, fileIdxValues);
  const indexSeenInFile = new Set();
  const errors = [];
  const passing = [];

  // Validation pass — pure CPU, no DB. Cheap even at 100K+ rows.
  for (const row of rows) {
    const result = validateRow({
      kind, row, effective: mapping, lookups, fileName: attempt.file_name,
      indexSeenInFile, existingIndex,
    });
    if (!result.ok) {
      errors.push({
        row_number: row.__row_number,
        error_code: result.code,
        error_message: result.message,
        raw_row: row.__raw,
      });
    } else {
      passing.push({ rowNumber: row.__row_number, raw: row.__raw, values: result.values });
    }
  }

  // Batched insert pass. One transaction per batch (not per row). If a
  // batch hits an unexpected DB error we retry it one-by-one so we can
  // identify which row(s) caused it instead of losing the whole batch.
  let rows_loaded = 0;
  for (let i = 0; i < passing.length; i += INSERT_BATCH) {
    const batch = passing.slice(i, i + INSERT_BATCH);
    try {
      await withTransaction(async (client) => {
        const { sql, params } = buildBulkInsertSql(kind, batch, attempt.attempt_id);
        const ins = await client.query(sql, params);
        const newIds = ins.rows.map((r) => r[kind.pkColumn]);
        await bulkLogChange(client, kind.changeLogObjectType, newIds, actor);
      });
      rows_loaded += batch.length;
    } catch (e) {
      for (const item of batch) {
        try {
          await withTransaction(async (client) => {
            const { sql, params } = buildBulkInsertSql(kind, [item], attempt.attempt_id);
            const ins = await client.query(sql, params);
            await bulkLogChange(client, kind.changeLogObjectType, [ins.rows[0][kind.pkColumn]], actor);
          });
          rows_loaded += 1;
        } catch (e2) {
          errors.push({
            row_number: item.rowNumber,
            error_code: 'bad_format',
            error_message: `Row ${item.rowNumber} of ${attempt.file_name} failed to insert: ${e2.message}`,
            raw_row: item.raw,
          });
        }
      }
    }
  }

  // Persist errors in batches too — a single VALUES list of 100K rows would
  // blow the parameter limit.
  for (let i = 0; i < errors.length; i += ERROR_BATCH) {
    const slice = errors.slice(i, i + ERROR_BATCH);
    const values = [];
    const placeholders = [];
    let p = 1;
    for (const e of slice) {
      placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      values.push(attempt.attempt_id, e.row_number, e.error_code, e.error_message, e.raw_row);
    }
    await pool.query(
      `INSERT INTO load_errors (attempt_id, row_number, error_code, error_message, raw_row)
       VALUES ${placeholders.join(', ')}`,
      values
    );
  }

  const rows_total = rows.length;
  const rows_failed = errors.length;
  let status;
  if (rows_failed === 0) status = 'Success';
  else if (rows_loaded === 0) status = 'Failure';
  else status = 'PartialSuccess';

  await pool.query(
    `UPDATE load_attempts
        SET completed_at = NOW(), rows_total = $1, rows_loaded = $2, rows_failed = $3, status = $4
      WHERE attempt_id = $5`,
    [rows_total, rows_loaded, rows_failed, status, attempt.attempt_id]
  );

  // Return a compact summary instead of every individual error — for a
  // 100K-row file the client would otherwise receive a multi-megabyte
  // payload. Counts by error code + first few example errors give the
  // user enough to act on; full list is fetched on-demand from
  // GET /loads/attempts/:id.
  const byCode = {};
  for (const e of errors) byCode[e.error_code] = (byCode[e.error_code] || 0) + 1;

  return {
    attempt_id: attempt.attempt_id,
    status,
    rows_total,
    rows_loaded,
    rows_failed,
    dropped_targets: droppedTargets || [],
    errors_by_code: byCode,
    sample_errors: errors.slice(0, 10).map((e) => ({
      row_number: e.row_number,
      error_code: e.error_code,
      error_message: e.error_message,
    })),
  };
}

export async function recordFileLevelFailure(attempt_id, code, message) {
  await pool.query(
    `UPDATE load_attempts
        SET completed_at = NOW(), status = 'Failure',
            fatal_error_code = $1, fatal_error_message = $2
      WHERE attempt_id = $3`,
    [code, message, attempt_id]
  );
}
