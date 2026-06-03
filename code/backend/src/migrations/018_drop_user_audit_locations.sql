-- 018: drop the user_audit_locations join table.
--
-- Earlier Phase 3 drafts kept the ASO's locked audit location in a parallel
-- join table (created in migration 014). The revised spec (`task3-aso.md` §10)
-- removes it: the ASO's location now lives on `users.location_id`
-- (migration 017), the single source of truth. This Phase-3-internal table
-- has no Phase 1/2 dependents, so dropping it is safe and within Phase 3's
-- own scope.
--
-- Migration 014 no longer creates the table on fresh installs; this DROP
-- removes it from databases that already ran the older 014. Idempotent.

DROP TABLE IF EXISTS user_audit_locations;
