-- 023: Move the Adaptor / USB-cable association from the Innoviti SKU down to
-- the Vendor SKU (the physical SKU).
--
-- Rationale: an Innoviti SKU is a broad classification (e.g. "Payment
-- Terminal"); the physical models that fulfil it are Vendor SKUs (MOVE, PAX,
-- …) and each carries its own adaptor + USB cable. The references therefore now
-- live on the Vendor SKU and point at OTHER Vendor SKUs of type "Adaptors" /
-- "USB cables" (not at Innoviti SKUs as before).
--
-- Per the product decision, the old Innoviti-side selections are NOT migrated —
-- the Innoviti columns are simply dropped. Idempotent — re-runs on every boot.

ALTER TABLE vendor_skus ADD COLUMN IF NOT EXISTS adaptor_vendor_sku_ids   JSONB;
ALTER TABLE vendor_skus ADD COLUMN IF NOT EXISTS usb_cable_vendor_sku_ids JSONB;

ALTER TABLE skus DROP COLUMN IF EXISTS adaptor_sku_ids;
ALTER TABLE skus DROP COLUMN IF EXISTS usb_cable_sku_ids;
