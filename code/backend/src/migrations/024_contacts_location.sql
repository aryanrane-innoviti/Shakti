-- 024: Contacts own their Location (hierarchy reshape — association lives on
-- the inferior object; task1.md §1.12 / §4). A Contact may belong to at most
-- one Location, which must be of the Contact's own vendor. The Location no
-- longer references contacts; the old principal/secondary/owner_type columns are
-- dropped in migration 026 (with migration 019 neutralized so it can't fight the
-- drop on the every-boot re-run).
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, partial index IF NOT EXISTS.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(location_id);

CREATE INDEX IF NOT EXISTS idx_contacts_location
  ON contacts(location_id) WHERE location_id IS NOT NULL;
