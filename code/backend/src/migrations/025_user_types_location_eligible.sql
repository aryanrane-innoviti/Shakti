-- 025: User Types carry a `location_eligible` flag (task1.md §2). When true,
-- Users of this type attach an Inventory Location on the User Create / Modify
-- form (the form renders a Location picker; the picker is filtered to the
-- user's own vendor's locations). New custom types default to FALSE here; the
-- eight seeded types have their value enforced by the seeder (lib/seed.js) on
-- every boot — SA / ADMIN / ASO / STU = TRUE, the rest = FALSE.
--
-- Additive + idempotent.

ALTER TABLE user_types
  ADD COLUMN IF NOT EXISTS location_eligible BOOLEAN NOT NULL DEFAULT FALSE;
