-- 010: Drop the legacy sku_vendor_assocs table.
--
-- The vendor↔Innoviti-SKU relationship now lives entirely in vendor_skus +
-- sku_vendor_links (migration 008). sku_vendor_assocs was kept temporarily so
-- its Phase-1 data could be migrated; that is done, and nothing reads it any
-- more. Dropping it also removes its indexes. Idempotent — re-runs on boot.

DROP TABLE IF EXISTS sku_vendor_assocs;
