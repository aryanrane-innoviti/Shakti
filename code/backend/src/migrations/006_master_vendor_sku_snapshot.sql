-- 006: Record the Vendor SKU number a stock row was loaded under.
-- Payment Terminal and Base Station rows are matched by Owner + Vendor SKU
-- number; this snapshot lets View Stock show the Innoviti SKU <-> Vendor SKU
-- association. SIM Card rows match by Innoviti SKU number and carry no
-- vendor SKU. Idempotent — migrations re-run on every boot.

ALTER TABLE payment_terminal_master ADD COLUMN IF NOT EXISTS vendor_sku_number_snapshot TEXT;
ALTER TABLE base_station_master     ADD COLUMN IF NOT EXISTS vendor_sku_number_snapshot TEXT;
