-- 016: SIM Card Master gains a Date of Purchase column.
--
-- Completes the SIM ↔ Payment Terminal / Base Station parity started in
-- migration 015 (owner vendor). Payment Terminal Master and Base Station
-- Master have carried `date_of_purchase` since migration 002; the `task2.md`
-- §3 spec now lists it as an optional SIM source-file column, matching PT/BS.
--
-- NULLABILITY: the column is NULLABLE — `date_of_purchase` is optional on a
-- SIM load (the loader writes NULL when the source row omits it), identical
-- to the relaxed PT/BS behaviour from migration 003. No back-fill: SIM rows
-- loaded before this migration simply keep `date_of_purchase = NULL`.
--
-- Migrations re-run on every boot, so this is idempotent.

ALTER TABLE sim_card_master
  ADD COLUMN IF NOT EXISTS date_of_purchase DATE;
