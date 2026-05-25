-- 008: Vendor SKU becomes a first-class entity that can supply many Innoviti SKUs.
--
-- The vendor↔Innoviti-SKU relationship is modelled as:
--   * `vendor_skus`      — the vendor SKU itself (number, name, price, spec).
--   * `sku_vendor_links` — many-to-many link between an Innoviti SKU and a
--                          vendor SKU, carrying the "default supplier" flag.
--
-- Migrations re-run on every boot, so everything here is idempotent.

CREATE TABLE IF NOT EXISTS vendor_skus (
  vendor_sku_id                SERIAL PRIMARY KEY,
  vendor_id                    INTEGER NOT NULL REFERENCES vendors(vendor_id),
  vendor_sku_number            TEXT NOT NULL,
  vendor_sku_name              TEXT,
  vendor_sku_price_moq         INTEGER,
  vendor_sku_price_unit        NUMERIC,
  vendor_sku_specification_pdf TEXT,
  status                       TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                   TIMESTAMPTZ
);
-- A vendor cannot have two live vendor SKUs with the same number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_skus_unique
  ON vendor_skus(vendor_id, vendor_sku_number) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sku_vendor_links (
  sku_vendor_link_id  SERIAL PRIMARY KEY,
  sku_id              INTEGER NOT NULL REFERENCES skus(sku_id),
  vendor_sku_id       INTEGER NOT NULL REFERENCES vendor_skus(vendor_sku_id),
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
-- One live link per (Innoviti SKU, vendor SKU) pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_svl_unique
  ON sku_vendor_links(sku_id, vendor_sku_id) WHERE deleted_at IS NULL;
-- At most one default vendor SKU per Innoviti SKU.
CREATE UNIQUE INDEX IF NOT EXISTS idx_svl_one_default_per_sku
  ON sku_vendor_links(sku_id) WHERE is_default AND deleted_at IS NULL;
