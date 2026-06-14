import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { nextIndex } from './ids.js';

// `location_eligible` controls whether Users of this type attach an Inventory
// Location on the User form (task1.md §2). SA / ADMIN are tied to Bangalore HO;
// ASO / STU carry an audit / store location. The rest carry none.
const USER_TYPES = [
  { code: 'SA', label: 'Super Admin', is_immutable: true, location_eligible: true },
  { code: 'ADMIN', label: 'Admin', is_immutable: true, location_eligible: true },
  { code: 'ASO', label: 'Area Service Officer', is_immutable: false, location_eligible: true },
  { code: 'STU', label: 'Store User', is_immutable: false, location_eligible: true },
  { code: 'ALU', label: 'Assembly Line User', is_immutable: false, location_eligible: false },
  { code: 'RLU', label: 'Repair Line User', is_immutable: false, location_eligible: false },
  { code: 'FNU', label: 'Finance User', is_immutable: false, location_eligible: false },
  { code: 'LOU', label: 'Logistics User', is_immutable: false, location_eligible: false },
];

const VENDOR_TYPES = [
  'Logistics Vendors',
  'SKU Vendors',
  'Service Vendors',
  'Merchant',
  'Innoviti',
];

const SKU_TYPES = [
  { name: 'Payment Terminal', serial: true },
  { name: 'Base Station', serial: true },
  { name: 'SIM Card', serial: true },
  { name: 'Assembly Line Assets', serial: false },
  { name: 'Adaptors', serial: false },
  { name: 'USB cables', serial: false },
  { name: 'Paper rolls', serial: false },
  { name: 'Tools', serial: false },
  { name: 'Consumables', serial: false },
  { name: 'Spare Parts', serial: false },
];

export async function runSeed() {
  await withTransaction(async (client) => {
    for (const t of USER_TYPES) {
      // location_eligible is fixed for the seeded types — enforce it on every
      // boot via DO UPDATE, while leaving any SA-renamed label untouched.
      await client.query(
        `INSERT INTO user_types (code, label, is_seed, is_immutable, location_eligible)
         VALUES ($1, $2, TRUE, $3, $4)
         ON CONFLICT (code) DO UPDATE SET location_eligible = EXCLUDED.location_eligible`,
        [t.code, t.label, t.is_immutable, t.location_eligible]
      );
    }

    for (const n of VENDOR_TYPES) {
      const exists = await client.query(
        `SELECT 1 FROM vendor_types WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
        [n]
      );
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO vendor_types (name, is_seed) VALUES ($1, TRUE)`,
          [n]
        );
      }
    }

    for (const s of SKU_TYPES) {
      const exists = await client.query(
        `SELECT 1 FROM sku_types WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
        [s.name]
      );
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO sku_types (name, serial_eligible, is_seed) VALUES ($1, $2, TRUE)`,
          [s.name, s.serial]
        );
      }
    }

    const { rows: vtRows } = await client.query(
      `SELECT vendor_type_id FROM vendor_types WHERE name = 'Innoviti'`
    );
    const innovitiTypeId = vtRows[0].vendor_type_id;

    const { rows: vRows } = await client.query(
      `SELECT vendor_id FROM vendors WHERE company_name = 'Innoviti' AND is_seed = TRUE`
    );
    if (!vRows.length) {
      const idx = await nextIndex('vendor', client);
      await client.query(
        `INSERT INTO vendors (vendor_index, company_name, vendor_type_id, is_seed, status)
         VALUES ($1, 'Innoviti', $2, TRUE, 'Active')`,
        [idx, innovitiTypeId]
      );
    }
    const { rows: innovRows } = await client.query(
      `SELECT vendor_id FROM vendors WHERE company_name = 'Innoviti' AND is_seed = TRUE`
    );
    const innovitiVendorId = innovRows[0].vendor_id;

    // Cold-start default location: Bangalore HO, owned by the Innoviti vendor
    // (task1.md §1.12 / §9). The seeded SA and the first Admin are tied to it.
    const { rows: hoRows } = await client.query(
      `SELECT location_id FROM locations
        WHERE location_name = 'Bangalore HO' AND vendor_id = $1 AND deleted_at IS NULL`,
      [innovitiVendorId]
    );
    let bangaloreHoId = hoRows[0]?.location_id;
    if (!bangaloreHoId) {
      const lidx = await nextIndex('location', client);
      const { rows: locIns } = await client.query(
        `INSERT INTO locations
           (location_index, vendor_id, location_name, address_line_1, pincode, city, state)
         VALUES ($1, $2, 'Bangalore HO', 'Innoviti HQ', '560103', 'Bengaluru', 'Karnataka')
         RETURNING location_id`,
        [lidx, innovitiVendorId]
      );
      bangaloreHoId = locIns[0].location_id;
    }

    const { rows: saTypeRows } = await client.query(
      `SELECT user_type_id FROM user_types WHERE code = 'SA'`
    );
    const saTypeId = saTypeRows[0].user_type_id;

    const { rows: saRows } = await client.query(
      `SELECT user_id FROM users WHERE user_type_id = $1`,
      [saTypeId]
    );

    const hash = bcrypt.hashSync(config.saPassword, 10);
    if (!saRows.length) {
      const idx = await nextIndex('user', client);
      await client.query(
        `INSERT INTO users
           (user_index, first_name, last_name, user_type_id, email, password_hash, vendor_id, location_id, status)
         VALUES ($1, 'Super', 'Admin', $2, $3, $4, $5, $6, 'Active')`,
        [idx, saTypeId, config.saEmail, hash, innovitiVendorId, bangaloreHoId]
      );
    } else {
      // Don't stomp a manually-changed SA location; just fill it if missing.
      await client.query(
        `UPDATE users SET password_hash = $1, email = $2, status = 'Active',
                          location_id = COALESCE(location_id, $4)
          WHERE user_id = $3`,
        [hash, config.saEmail, saRows[0].user_id, bangaloreHoId]
      );
    }
  });
}
