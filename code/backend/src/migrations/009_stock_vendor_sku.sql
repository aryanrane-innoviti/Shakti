-- 009: Stock units (Payment Terminal / Base Station) anchor to a vendor SKU.
--
-- Phase 2 of the many-to-many rework. A loaded unit belongs to its vendor SKU,
-- not to a single Innoviti SKU — the Innoviti SKU(s) are derived through
-- sku_vendor_links. View Stock therefore rolls a unit up under every linked
-- Innoviti SKU. SIM Cards are unchanged: they still match by Innoviti SKU
-- number and keep sku_id.
--
-- Migrations re-run on every boot, so everything here is idempotent.

ALTER TABLE payment_terminal_master ADD COLUMN IF NOT EXISTS vendor_sku_id INTEGER REFERENCES vendor_skus(vendor_sku_id);
ALTER TABLE base_station_master     ADD COLUMN IF NOT EXISTS vendor_sku_id INTEGER REFERENCES vendor_skus(vendor_sku_id);

-- A Payment Terminal / Base Station row no longer carries one Innoviti SKU,
-- so sku_id and its snapshot become optional on those two tables.
ALTER TABLE payment_terminal_master ALTER COLUMN sku_id DROP NOT NULL;
ALTER TABLE payment_terminal_master ALTER COLUMN sku_number_snapshot DROP NOT NULL;
ALTER TABLE base_station_master     ALTER COLUMN sku_id DROP NOT NULL;
ALTER TABLE base_station_master     ALTER COLUMN sku_number_snapshot DROP NOT NULL;

-- A serial number is unique per vendor SKU among live rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptm_vsku_serial
  ON payment_terminal_master (vendor_sku_id, serial_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bsm_vsku_serial
  ON base_station_master (vendor_sku_id, serial_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ptm_vendor_sku ON payment_terminal_master(vendor_sku_id);
CREATE INDEX IF NOT EXISTS idx_bsm_vendor_sku ON base_station_master(vendor_sku_id);

-- Back-fill vendor_sku_id on existing rows from the recorded vendor SKU number
-- + owner vendor. Rows loaded before the snapshot column existed stay NULL.
UPDATE payment_terminal_master m
   SET vendor_sku_id = vs.vendor_sku_id
  FROM vendor_skus vs
 WHERE m.vendor_sku_id IS NULL
   AND m.vendor_sku_number_snapshot IS NOT NULL
   AND vs.vendor_id = m.owner_vendor_id
   AND vs.vendor_sku_number = m.vendor_sku_number_snapshot;

UPDATE base_station_master m
   SET vendor_sku_id = vs.vendor_sku_id
  FROM vendor_skus vs
 WHERE m.vendor_sku_id IS NULL
   AND m.vendor_sku_number_snapshot IS NOT NULL
   AND vs.vendor_id = m.owner_vendor_id
   AND vs.vendor_sku_number = m.vendor_sku_number_snapshot;
