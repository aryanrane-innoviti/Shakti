-- 019: (SUPERSEDED — now a no-op) location owner-type toggle, REMOVED.
--
-- This migration originally added a Contact/ASO `owner_type` toggle to
-- `locations` and made `principal_contact_id` nullable, to support ASO-owned
-- locations. That whole Contact/ASO ownership concept was retired in the
-- object-hierarchy reshape (task1.md §1.12 / §9): a Location now carries only
-- vendor + name + address, and the Location<->Contact association lives on the
-- Contact (`contacts.location_id`, migration 024).
--
-- Its columns (`owner_type`, `secondary_contact_id`, `principal_contact_id`)
-- are dropped by migration 026. This file is intentionally a no-op now: its
-- former `ALTER COLUMN principal_contact_id DROP NOT NULL` would FAIL on the
-- boot after 026 removes that column (migrations re-run every boot), so it must
-- not run. The end state converges identically for fresh and existing DBs.

SELECT 1;
