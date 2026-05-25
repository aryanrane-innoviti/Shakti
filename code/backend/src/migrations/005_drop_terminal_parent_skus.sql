-- 005: Remove the Terminal Parent SKU feature entirely.
-- The skus.parent_sku_id foreign key is dropped first so the table it
-- references can then be dropped. All statements are idempotent because
-- migrations re-run on every boot.

ALTER TABLE skus DROP COLUMN IF EXISTS parent_sku_id;
DROP TABLE IF EXISTS terminal_parent_skus;
DELETE FROM counters WHERE name = 'parent_sku';
