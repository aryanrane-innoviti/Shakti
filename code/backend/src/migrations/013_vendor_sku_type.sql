-- 013: Re-introduce SKU Type on Vendor SKUs.
--
-- A vendor SKU once again belongs to one SKU Type. This lets the Innoviti SKU
-- create screen filter vendor SKUs to ones of a matching category, and the
-- backend enforces that every linked vendor SKU shares the Innoviti SKU's type.
--
-- The column is nullable at the DB level so pre-existing vendor SKUs are not
-- broken; new vendor SKUs are required to provide it at the API layer. Existing
-- rows are back-filled from the type of any Innoviti SKU they are already
-- linked to. Idempotent — re-runs on every boot.

ALTER TABLE vendor_skus ADD COLUMN IF NOT EXISTS sku_type_id INTEGER REFERENCES sku_types(sku_type_id);

UPDATE vendor_skus vs
   SET sku_type_id = sub.sku_type_id
  FROM (
    SELECT DISTINCT ON (l.vendor_sku_id) l.vendor_sku_id, s.sku_type_id
      FROM sku_vendor_links l
      JOIN skus s ON s.sku_id = l.sku_id
     ORDER BY l.vendor_sku_id, l.sku_vendor_link_id
  ) sub
 WHERE vs.vendor_sku_id = sub.vendor_sku_id
   AND vs.sku_type_id IS NULL;
