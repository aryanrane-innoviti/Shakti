-- 021: query-optimization indexes (additive, follows 020_perf_indexes.sql).
--
-- Found by a static query-optimization audit of the route/lib query paths. Each
-- index below is tied to a specific query that filters/joins/orders on columns
-- the existing indexes did not cover. All are additive and idempotent
-- (CREATE INDEX IF NOT EXISTS), re-run safely on every boot, and never change
-- query results — only their speed. No CONCURRENTLY: the migration runner runs
-- each file as a single implicit transaction.
--
-- Convention (per 020): partial on `deleted_at IS NULL` to match how list/seed
-- queries filter and to keep the index small. TWO deliberate exceptions are
-- documented inline where the consumer is NOT a soft-delete-filtered query.

-- =====================================================================
-- 1) Master tables filtered by (present_location_id, state).
--
-- routes/auditSessions.js::seedTable1() runs, inside the session-create
-- transaction on every audit, INSERT...SELECT over each master filtered by
-- `present_location_id = $ AND deleted_at IS NULL AND state = ANY($)`. The
-- existing idx_*_location indexes (migration 002) are NON-partial single-column
-- on present_location_id, so they cannot skip soft-deleted rows or pre-filter
-- by state. The partial composite below also serves View Stock's
-- `present_location_id = $ AND deleted_at IS NULL` list filter (routes/stock.js)
-- via its leading column, so no separate location-only index is needed.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_ptm_loc_state
  ON payment_terminal_master(present_location_id, state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bsm_loc_state
  ON base_station_master(present_location_id, state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scm_loc_state
  ON sim_card_master(present_location_id, state) WHERE deleted_at IS NULL;

-- =====================================================================
-- 2) Master tables filtered by date_of_purchase range.
--
-- routes/stock.js::buildFilters() emits `date_of_purchase >= $ / <= $` for the
-- View Stock list/summary endpoints; date_of_purchase had no index on any
-- master. Partial on deleted_at IS NULL to match the always-present filter.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_ptm_date_of_purchase
  ON payment_terminal_master(date_of_purchase) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bsm_date_of_purchase
  ON base_station_master(date_of_purchase) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scm_date_of_purchase
  ON sim_card_master(date_of_purchase) WHERE deleted_at IS NULL;

-- =====================================================================
-- 3) Master tables: case-insensitive index-value lookup for the load
--    duplicate-check.
--
-- lib/load/commit.js::existingIndexSet() now probes existing rows by
-- `lower(serial_number) / lower(sim_card_number) = ANY($)` (only the values
-- present in the uploaded file). The existing unique indexes lead with the
-- anchor column and are on the RAW value, so they cannot serve a lower()
-- lookup. These functional partial indexes turn that per-commit check from a
-- full master scan into index probes.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_ptm_serial_lower
  ON payment_terminal_master(lower(serial_number)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bsm_serial_lower
  ON base_station_master(lower(serial_number)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scm_simnum_lower
  ON sim_card_master(lower(sim_card_number)) WHERE deleted_at IS NULL;

-- =====================================================================
-- 4) Master tables: foreign key loaded_via_attempt_id.
--
-- DELETE /loads/attempts(/:id) removes load_attempts rows; the FK
-- `loaded_via_attempt_id REFERENCES load_attempts` on each master has no index,
-- so each delete seq-scans the whole master to enforce referential integrity.
-- EXCEPTION to the partial convention: the FK integrity check sees ALL child
-- rows (soft-deleted ones still carry the NOT NULL FK), so a partial
-- `WHERE deleted_at IS NULL` index would NOT be usable by it. Must be plain.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_ptm_loaded_via_attempt
  ON payment_terminal_master(loaded_via_attempt_id);
CREATE INDEX IF NOT EXISTS idx_bsm_loaded_via_attempt
  ON base_station_master(loaded_via_attempt_id);
CREATE INDEX IF NOT EXISTS idx_scm_loaded_via_attempt
  ON sim_card_master(loaded_via_attempt_id);

-- =====================================================================
-- 5) users.user_type_id and users.vendor_id.
--
-- user_type_id: the ADMIN-existence check in lib/auth.js::attachInitialSetupFlag
-- runs on every request, plus GET /users?user_type_id= filters on it.
-- vendor_id: GET /users?vendor_id= and the vendor-delete dependency check
-- (routes/vendors.js) filter on it — the same pattern 020 already indexed for
-- contacts.vendor_id and locations.vendor_id; users was missed.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_users_user_type
  ON users(user_type_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_vendor
  ON users(vendor_id) WHERE deleted_at IS NULL;

-- =====================================================================
-- 6) change_log: object_type filter + occurred_at ordering.
--
-- GET /change-log does `WHERE object_type = $ ORDER BY occurred_at DESC LIMIT n`
-- (object_type is the primary UI filter). idx_change_log_object(object_type,
-- object_id) cannot supply the occurred_at order; idx_change_log_time
-- (occurred_at) discards non-matching types during the scan. The composite
-- below answers the equality + top-N order in one ranged scan. change_log has
-- no deleted_at, so a plain (non-partial) index is correct.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_change_log_object_time
  ON change_log (object_type, occurred_at DESC);
