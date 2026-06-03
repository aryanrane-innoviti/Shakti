-- 020: performance indexes for foreign keys and list filters that the schema
-- accreted over time without covering indexes. All are additive and idempotent
-- (CREATE INDEX IF NOT EXISTS), so they re-run safely on every boot and never
-- change query results — only their speed.
--
-- Each index is partial on `deleted_at IS NULL` to match how every list/lookup
-- query filters (soft-delete is universal here) and to keep the index small.
--
-- Skipped deliberately:
--   * user_types.code        — already UNIQUE (auto-indexed).
--   * user_types / sku_types — ~8–10 row seed tables; a scan is free.
--   * audit_sessions(auditor,status) — the partial idx_audit_sessions_one_open
--     and idx_audit_sessions_auditor already cover the hot lookups.

-- contacts.vendor_id: GET /contacts?vendor_id and the vendor-delete dependency
-- check both filter on it; there was no index.
CREATE INDEX IF NOT EXISTS idx_contacts_vendor
  ON contacts(vendor_id) WHERE deleted_at IS NULL;

-- locations.vendor_id: GET /locations?vendor_id and the vendor-delete check.
CREATE INDEX IF NOT EXISTS idx_locations_vendor
  ON locations(vendor_id) WHERE deleted_at IS NULL;

-- vendor_skus.vendor_id / .sku_type_id: GET /vendor-skus filters by both.
CREATE INDEX IF NOT EXISTS idx_vendor_skus_vendor
  ON vendor_skus(vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_skus_sku_type
  ON vendor_skus(sku_type_id) WHERE deleted_at IS NULL;

-- sku_vendor_links.vendor_sku_id: the existing unique index leads on sku_id, so
-- joins that start from vendor_sku_id (stock summary, audit-table seeding,
-- vendor-sku delete) had no usable index on that side.
CREATE INDEX IF NOT EXISTS idx_sku_vendor_links_vendor_sku
  ON sku_vendor_links(vendor_sku_id) WHERE deleted_at IS NULL;

-- vendors(company_name, is_seed): the "Innoviti seed vendor" lookup. It is now
-- also memoized in lib/seedRefs.js, but the index keeps cold-start / multi-
-- instance lookups cheap and helps any company_name filter as vendors grow.
CREATE INDEX IF NOT EXISTS idx_vendors_company_seed
  ON vendors(company_name, is_seed) WHERE deleted_at IS NULL;
