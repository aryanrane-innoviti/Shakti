import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { nextIndex } from './ids.js';

const USER_TYPES = [
  { code: 'SA', label: 'Super Admin', is_immutable: true },
  { code: 'ADMIN', label: 'Admin', is_immutable: true },
  { code: 'ASO', label: 'Area Service Officer', is_immutable: false },
  { code: 'STU', label: 'Store User', is_immutable: false },
  { code: 'ALU', label: 'Assembly Line User', is_immutable: false },
  { code: 'RLU', label: 'Repair Line User', is_immutable: false },
  { code: 'FNU', label: 'Finance User', is_immutable: false },
  { code: 'LOU', label: 'Logistics User', is_immutable: false },
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
      await client.query(
        `INSERT INTO user_types (code, label, is_seed, is_immutable)
         VALUES ($1, $2, TRUE, $3) ON CONFLICT (code) DO NOTHING`,
        [t.code, t.label, t.is_immutable]
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
      const { rows: innov } = await client.query(
        `SELECT vendor_id FROM vendors WHERE company_name = 'Innoviti' AND is_seed = TRUE`
      );
      const idx = await nextIndex('user', client);
      await client.query(
        `INSERT INTO users
           (user_index, first_name, last_name, user_type_id, email, password_hash, vendor_id, status)
         VALUES ($1, 'Super', 'Admin', $2, $3, $4, $5, 'Active')`,
        [idx, saTypeId, config.saEmail, hash, innov[0].vendor_id]
      );
    } else {
      await client.query(
        `UPDATE users SET password_hash = $1, email = $2, status = 'Active'
          WHERE user_id = $3`,
        [hash, config.saEmail, saRows[0].user_id]
      );
    }
  });
}
