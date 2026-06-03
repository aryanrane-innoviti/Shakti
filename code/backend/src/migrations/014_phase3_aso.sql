-- 014: Phase 3 (ASO slice) — Audit Session for ASO Users.
--
-- ADDITIVE ONLY. Does not modify any Phase 1 or Phase 2 table, index, or
-- constraint. Four new tables; the `change_log.object_type` column already
-- accepts arbitrary text (no enum / no CHECK) so the three new values
-- (`AuditSession`, `AuditSerialRow`, `AuditAccessoryRow`) need no schema
-- migration to be accepted. The ASO's audit location lives on the Phase 1
-- `users.location_id` column (migration 017) — there is no parallel join
-- table (`task3-aso.md` §10; the older `user_audit_locations` table is
-- dropped in migration 018).
--
-- Migrations re-run on every boot, so everything below is idempotent.

-- =====================================================================
-- 1) audit_sessions — top-level Audit Session.
--
-- AIN-NNNNN issued via lib/ids.js::nextIndex('audit'). Lifecycle:
--   Incomplete   → user resumable
--   PendingReview→ user pressed Complete; awaiting Store review (Store slice)
--   Cancelled    → user pressed Cancel; deleted_at = NOW()
--   Completed    → reserved for the Store-review slice; never written here.
--
-- Partial unique index enforces one non-terminal session per ASO.
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_sessions (
  audit_session_id        SERIAL PRIMARY KEY,
  audit_index             TEXT NOT NULL UNIQUE,
  auditor_user_id         INTEGER NOT NULL REFERENCES users(user_id),
  auditor_user_index      TEXT NOT NULL,
  location_id             INTEGER NOT NULL REFERENCES locations(location_id),
  location_snapshot_name  TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'Incomplete'
                            CHECK (status IN ('Incomplete','PendingReview','Cancelled','Completed')),
  table1_state            TEXT NOT NULL DEFAULT 'Editing'
                            CHECK (table1_state IN ('Editing','Submitted')),
  table2_state            TEXT NOT NULL DEFAULT 'Editing'
                            CHECK (table2_state IN ('Editing','Submitted')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_suspended_at       TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);
-- One non-terminal session per user (Incomplete or PendingReview).
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_sessions_one_open
  ON audit_sessions(auditor_user_id)
  WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_sessions_auditor ON audit_sessions(auditor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_location ON audit_sessions(location_id);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_status ON audit_sessions(status);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_started ON audit_sessions(started_at);
-- Used by the 5-minute auto-suspension job's WHERE clause.
CREATE INDEX IF NOT EXISTS idx_audit_sessions_suspend
  ON audit_sessions(last_activity_at)
  WHERE status = 'Incomplete' AND auto_suspended_at IS NULL AND deleted_at IS NULL;

-- =====================================================================
-- 2) audit_session_serial_rows — Table 1 rows (PT / BS / SIM).
--
-- A row is exactly one of:
--   - Expected      (expected_serial_number is non-null; matched starts false)
--   - Unexpected    (unexpected_serial_number is non-null; in some Master)
--   - Unregistered  (unregistered_serial_number is non-null; not in any Master)
-- Enforced by `chk_serial_row_category` (exactly-one-of-three).
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_session_serial_rows (
  audit_serial_row_id          SERIAL PRIMARY KEY,
  audit_session_id             INTEGER NOT NULL REFERENCES audit_sessions(audit_session_id),
  master_kind                  TEXT
                                 CHECK (master_kind IS NULL
                                        OR master_kind IN ('payment_terminal','base_station','sim_card')),
  master_row_id                BIGINT,
  vendor_sku_id_snapshot       INTEGER REFERENCES vendor_skus(vendor_sku_id),
  vendor_sku_number_snapshot   TEXT,
  vendor_sku_name_snapshot     TEXT,
  sku_id_snapshot              INTEGER REFERENCES skus(sku_id),
  sku_number_snapshot          TEXT,
  sku_name_snapshot            TEXT,
  expected_serial_number       TEXT,
  unexpected_serial_number     TEXT,
  unregistered_serial_number   TEXT,
  matched                      BOOLEAN NOT NULL DEFAULT FALSE,
  missing                      BOOLEAN NOT NULL DEFAULT FALSE,
  remarks                      TEXT,
  working_status               TEXT NOT NULL DEFAULT 'Working'
                                 CHECK (working_status IN ('Working','Not Working')),
  scanned_at                   TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                   TIMESTAMPTZ,
  CONSTRAINT chk_serial_row_category CHECK (
    (CASE WHEN expected_serial_number     IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN unexpected_serial_number   IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN unregistered_serial_number IS NOT NULL THEN 1 ELSE 0 END) = 1
  ),
  CONSTRAINT chk_serial_row_master_kind CHECK (
    -- master_kind NULL only allowed for Unregistered rows.
    master_kind IS NOT NULL OR unregistered_serial_number IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_asrr_session ON audit_session_serial_rows(audit_session_id);
CREATE INDEX IF NOT EXISTS idx_asrr_expected
  ON audit_session_serial_rows(audit_session_id, expected_serial_number);
CREATE INDEX IF NOT EXISTS idx_asrr_unexpected
  ON audit_session_serial_rows(audit_session_id, unexpected_serial_number);
CREATE INDEX IF NOT EXISTS idx_asrr_unregistered
  ON audit_session_serial_rows(audit_session_id, unregistered_serial_number);

-- =====================================================================
-- 3) audit_session_accessory_rows — Table 2 rows (non-serial vendor SKUs).
--
-- One row per (session, vendor_sku). missing_count is NULL until the user
-- presses Submit on Table 2; clamped to 0 (no negative "found extras").
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_session_accessory_rows (
  audit_accessory_row_id      SERIAL PRIMARY KEY,
  audit_session_id            INTEGER NOT NULL REFERENCES audit_sessions(audit_session_id),
  vendor_sku_id               INTEGER NOT NULL REFERENCES vendor_skus(vendor_sku_id),
  vendor_sku_number_snapshot  TEXT NOT NULL,
  vendor_sku_name_snapshot    TEXT,
  expected_quantity           INTEGER NOT NULL DEFAULT 0
                                CHECK (expected_quantity >= 0),
  working_count               INTEGER NOT NULL DEFAULT 0
                                CHECK (working_count >= 0 AND working_count <= 10000),
  not_working_count           INTEGER NOT NULL DEFAULT 0
                                CHECK (not_working_count >= 0 AND not_working_count <= 10000),
  missing_count               INTEGER
                                CHECK (missing_count IS NULL OR missing_count >= 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asar_session_vendor_sku
  ON audit_session_accessory_rows(audit_session_id, vendor_sku_id);
CREATE INDEX IF NOT EXISTS idx_asar_session ON audit_session_accessory_rows(audit_session_id);

-- =====================================================================
-- 4) accessory_stock_balances — minimum-viable accessory quantity tracker.
--
-- Only READ by this ASO slice (seeds Table 2's expected_quantity). The
-- Store-review slice will WRITE this on audit approval. Not a full
-- Accessory Master object — that's a future-phase concern.
-- =====================================================================
CREATE TABLE IF NOT EXISTS accessory_stock_balances (
  accessory_stock_balance_id  SERIAL PRIMARY KEY,
  vendor_sku_id               INTEGER NOT NULL REFERENCES vendor_skus(vendor_sku_id),
  location_id                 INTEGER NOT NULL REFERENCES locations(location_id),
  working_quantity            INTEGER NOT NULL DEFAULT 0
                                CHECK (working_quantity >= 0),
  not_working_quantity        INTEGER NOT NULL DEFAULT 0
                                CHECK (not_working_quantity >= 0),
  last_audit_session_id       INTEGER REFERENCES audit_sessions(audit_session_id),
  last_updated_at             TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asb_vsku_loc
  ON accessory_stock_balances(vendor_sku_id, location_id);
