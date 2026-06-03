-- 017: users.location_id — the user's home Inventory Location.
--
-- Spec home is Phase 1 (`task1.md` §3): an optional, nullable FK to
-- `locations`. ASO users read it to know which location to audit; STU users
-- (Store-review slice) read it to know their store. No Phase 1/2 flow consumes
-- it. Assignment rides exclusively on `PUT /locations/{id}/aso-users` (and the
-- STU parallel) — never on the user-create/update endpoints (`task1.md` §3).
--
-- Delivered here as an additive migration: the column is NULLABLE so every
-- existing user row survives, and it carries no default so nothing is
-- silently assigned. The FK lets `ON`-nothing apply — locations are
-- soft-deleted (never hard-deleted) in this system, so the reference is safe.
--
-- Migrations re-run on every boot, so this is idempotent.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(location_id);

CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_id);
