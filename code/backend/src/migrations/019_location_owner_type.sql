-- 019: location owner type — every location is owned by EITHER Contact(s) OR
-- ASO user(s), never both. The location form exposes this as a mutually
-- exclusive toggle; this migration is the storage for it.
--
-- Two additive, idempotent changes:
--   1. principal_contact_id becomes NULLABLE — an ASO-owned location stores no
--      contact at all. Contact-owned locations still require it, but that rule
--      now lives at the app layer (routes/locations.js) because it is
--      conditional on owner_type. Every existing row has a principal contact,
--      so dropping the constraint changes nothing for them.
--   2. owner_type records which side of the toggle the location is on. It
--      defaults to 'Contact', so every pre-existing row (all of which carry a
--      principal contact) keeps its current meaning with no backfill needed.
--
-- Migrations re-run on every boot. ALTER COLUMN ... DROP NOT NULL is a no-op
-- once already nullable, and ADD COLUMN IF NOT EXISTS skips the whole
-- definition (CHECK included) on re-run — so both statements are idempotent.

ALTER TABLE locations
  ALTER COLUMN principal_contact_id DROP NOT NULL;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'Contact'
    CHECK (owner_type IN ('Contact','ASO'));
