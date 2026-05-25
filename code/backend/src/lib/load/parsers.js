// Format-agnostic parser dispatcher. Reads a file buffer + name, picks
// the right parser, returns the same shape regardless of source format:
//   { headers: string[], rows: [{ __row_number, __raw, [header]: value }] }
import * as XLSX from 'xlsx';
import { parseCsv, CsvError } from './csv.js';

export { CsvError };

function parseXlsx(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new CsvError(`could not read XLSX: ${e.message}`);
  }
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new CsvError('XLSX has no sheets');
  const sheet = wb.Sheets[firstSheet];
  // Get a matrix-style result so we have full control over header handling.
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  if (!matrix.length) throw new CsvError('XLSX first sheet is empty');

  let headers = matrix[0].map((h) => String(h ?? '').trim());
  // Trim trailing empty header columns — Excel commonly extends the used
  // range past the last real column.
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
  for (let i = 1; i < matrix.length; i++) {
    const cells = (matrix[i] || []).slice(0, headers.length);
    // Skip rows that are entirely blank (Excel sometimes carries trailing
    // empty rows in the used range).
    if (cells.every((c) => c == null || String(c).trim() === '')) continue;
    const obj = { __row_number: i, __raw: cells.join(',') };
    headers.forEach((h, idx) => {
      const v = cells[idx];
      obj[h] = v == null ? '' : String(v).trim();
    });
    rows.push(obj);
  }
  return { headers, rows };
}

export function detectFormat(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls'))  return 'xlsx'; // SheetJS handles legacy xls too
  return 'csv';
}

export function parseFile(buffer, fileName) {
  const fmt = detectFormat(fileName);
  if (fmt === 'xlsx') return parseXlsx(buffer);
  // CSV path: decode as UTF-8 text
  return parseCsv(buffer.toString('utf8'));
}
