-- 024: Contacts own their Location (hierarchy reshape — association lives on
-- the inferior object; task1.md §1.12 / §4). A Contact may belong to at most
-- one Location, which must be of the Contact's own vendor. The Location no
-- longer references contacts (the old principal/secondary columns are retained
-- in the schema but unused — they cannot be dropped because migration 019
-- re-runs every boot and operates on principal_contact_id / owner_type).
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, partial index IF NOT EXISTS.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(location_id);

CREATE INDEX IF NOT EXISTS idx_contacts_location
  ON contacts(location_id) WHERE location_id IS NOT NULL;
