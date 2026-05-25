// Tiny CSV parser. Comma-delimited. Quoted strings with "" escape.
// CRLF or LF line endings. UTF-8 BOM tolerated.
// Returns { headers, rows } on success; throws on malformed input.

export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.code = 'file_invalid';
  }
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseLine(line, lineNum) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') {
        if (cur.length) throw new CsvError(`malformed CSV at line ${lineNum}: stray quote`);
        inQuotes = true;
      }
      else cur += ch;
    }
  }
  if (inQuotes) throw new CsvError(`malformed CSV at line ${lineNum}: unterminated quote`);
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text) {
  const cleaned = stripBom(String(text || ''));
  // Normalize line endings then split. Account for quoted multi-line values
  // by scanning instead of naive split — but Phase 2 spec accepts only
  // single-line records, so this is acceptable.
  const rawLines = cleaned.split(/\r\n|\n|\r/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  if (!rawLines.length) throw new CsvError('empty file');
  const headers = parseLine(rawLines[0], 1);
  // Trim trailing empty header columns — Excel-exported CSVs frequently
  // carry a trailing comma on every line.
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (!headers.length) {
    throw new CsvError('header row missing or empty');
  }
  const seen = new Set();
  for (const h of headers) {
    if (!h) throw new CsvError('header row contains a blank column name');
    if (seen.has(h.toLowerCase())) throw new CsvError(`duplicate header '${h}'`);
    seen.add(h.toLowerCase());
  }
  const rows = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cells = parseLine(rawLines[i], i + 1);
    if (cells.length < headers.length) {
      throw new CsvError(`line ${i + 1}: expected at least ${headers.length} columns, got ${cells.length}`);
    }
    const trimmed = cells.slice(0, headers.length);
    // Drop fully-blank rows (Excel sometimes carries trailing empties).
    if (trimmed.every((c) => c == null || c === '')) continue;
    const obj = { __row_number: i, __raw: rawLines[i] };
    headers.forEach((h, idx) => { obj[h] = trimmed[idx]; });
    rows.push(obj);
  }
  return { headers, rows };
}
