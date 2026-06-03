-- 015: SIM Card Master gains an Owner Vendor column.
--
-- Brings SIM Card Master into shape parity with Payment Terminal Master and
-- Base Station Master, which have always carried `owner_vendor_id` (see
-- migration 002). The `task2.md` §3 spec now treats `owner` as a required
-- source-file column on SIM loads, matching PT/BS §2 / §4.
--
-- NULLABILITY: the DB column is NULLABLE so existing SIM rows (loaded under
-- the prior schema, which had no `owner` column at all) survive the
-- migration without a synthetic owner being invented. The SIM loader is
-- responsible for enforcing the required-at-load-time rule going forward
-- (`owner_not_found` error code, mirrors PT/BS). A later back-fill migration
-- can promote the column to NOT NULL once every live row has an owner —
-- not in scope here because no canonical mapping from a legacy SIM row to a
-- specific vendor exists.
--
-- NO BACK-FILL: SIM rows loaded before this migration have no field on the
-- source file that could be used to derive an owner. Attempting any default
-- (e.g. Innoviti) would silently misattribute units, so legacy rows stay
-- `owner_vendor_id = NULL` until a manual reconciliation runs.
--
-- Migrations re-run on every boot, so everything below is idempotent.

ALTER TABLE sim_card_master
  ADD COLUMN IF NOT EXISTS owner_vendor_id INTEGER REFERENCES vendors(vendor_id);

CREATE INDEX IF NOT EXISTS idx_scm_owner ON sim_card_master(owner_vendor_id);
