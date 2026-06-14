-- 026: Drop the vestigial Location<->Contact ownership columns.
--
-- The object-hierarchy reshape (task1.md §1.12 / §9) moved the
-- Location<->Contact association onto the Contact (`contacts.location_id`,
-- migration 024) and retired the Contact/ASO `owner_type` toggle. These three
-- `locations` columns are no longer read or written by the application, so they
-- are removed here rather than carried forward as dead schema. Migration 019
-- (which originally added them) is neutralized to a no-op so it can't fight this
-- drop when the migration set re-runs on every boot.
--
-- Idempotent: DROP COLUMN IF EXISTS (dropping a column also drops its FK/CHECK).
--
-- NOTE: existing principal/secondary contact links are NOT migrated into
-- contacts.location_id — they are dropped. The new model is re-populated from
-- the Contact form (task1.md §4).

ALTER TABLE locations DROP COLUMN IF EXISTS owner_type;
ALTER TABLE locations DROP COLUMN IF EXISTS secondary_contact_id;
ALTER TABLE locations DROP COLUMN IF EXISTS principal_contact_id;
