import { pool } from '../db.js';

// References to seed rows that never change after seeding. The Innoviti vendor
// is created once by runSeed() (is_seed = TRUE) and its id is stable for the
// life of the database, so we memoize it: the lookup was previously issued 7+
// times across the request paths, each a scan of `vendors`. We only cache a
// non-null result so a call that somehow precedes seeding doesn't poison the
// cache.
let _innovitiVendorId;

export async function getInnovitiVendorId(client) {
  if (_innovitiVendorId) return _innovitiVendorId;
  const runner = client || pool;
  const { rows } = await runner.query(
    `SELECT vendor_id FROM vendors WHERE company_name = 'Innoviti' AND is_seed = TRUE`
  );
  if (rows.length) _innovitiVendorId = rows[0].vendor_id;
  return rows.length ? rows[0].vendor_id : null;
}
