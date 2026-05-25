-- Enforce that a SKU name is unique (case-insensitive) within its SKU Type.
-- Migrations re-run on every boot, so this must be idempotent.

-- Disambiguate any pre-existing duplicates first — otherwise the unique index
-- below cannot be built. The oldest row (lowest sku_id) keeps the name; the
-- rest get their unique SKU number appended. Non-destructive: no row is lost,
-- and on a clean DB this UPDATE matches zero rows.
UPDATE skus s
   SET sku_name = s.sku_name || ' (' || s.sku_number || ')',
       updated_at = NOW()
  FROM (
    SELECT sku_id,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(sku_name), sku_type_id ORDER BY sku_id
           ) AS rn
      FROM skus
     WHERE deleted_at IS NULL
  ) d
 WHERE d.sku_id = s.sku_id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_name_type_ci
  ON skus (LOWER(sku_name), sku_type_id) WHERE deleted_at IS NULL;
