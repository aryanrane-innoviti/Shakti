-- 022: Phase 3 (Report slice) — Store review of ASO-authored PARs.
--
-- ADDITIVE ONLY. Builds on the Phase 3 (ASO) schema (migration 014) without
-- editing it or any other applied migration. Three changes, all idempotent
-- (migrations re-run on every boot):
--   1) Four nullable reviewer columns on each of the two ASO row tables.
--   2) One nullable reviewed_at (session-level reviewer-decision time) on
--      audit_sessions — deliberately SEPARATE from completed_at, which keeps
--      its ASO-slice meaning ("auditor pressed Complete").
--   3) Widen the audit_sessions.status CHECK to permit the new terminal value
--      'Rejected'. Strictly value-permitting — no existing row is invalidated.
--
-- No DDL on the Master tables or accessory_stock_balances: the Approved
-- write-back populates columns those tables already expose (Phase 2 created the
-- Master location/audit columns NULL-at-load for exactly this purpose).

-- =====================================================================
-- 1) Per-row reviewer state on the two ASO row tables.
--    reviewer_status is the reviewer's explicit verdict (NULL until they
--    touch the row); the auto-status rule fills the gap at read time.
-- =====================================================================
ALTER TABLE audit_session_serial_rows
  ADD COLUMN IF NOT EXISTS reviewer_status     TEXT
    CHECK (reviewer_status IS NULL OR reviewer_status IN ('Approved','Rejected')),
  ADD COLUMN IF NOT EXISTS reviewer_remarks    TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(user_id);

ALTER TABLE audit_session_accessory_rows
  ADD COLUMN IF NOT EXISTS reviewer_status     TEXT
    CHECK (reviewer_status IS NULL OR reviewer_status IN ('Approved','Rejected')),
  ADD COLUMN IF NOT EXISTS reviewer_remarks    TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(user_id);

-- =====================================================================
-- 2) Session-level reviewer-decision timestamp. NULL until Submit
--    finalizes the report to Completed (Approved) / Rejected.
-- =====================================================================
ALTER TABLE audit_sessions
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- =====================================================================
-- 3) Widen the status CHECK to add 'Rejected'. Migration 014 defined the
--    constraint inline, so PostgreSQL auto-named it audit_sessions_status_check.
--    DROP IF EXISTS + ADD makes this safe on every re-boot. 'Rejected' is NOT
--    in the idx_audit_sessions_one_open predicate, so a Rejected report is
--    terminal and does not block the ASO from starting a fresh audit.
-- =====================================================================
ALTER TABLE audit_sessions DROP CONSTRAINT IF EXISTS audit_sessions_status_check;
ALTER TABLE audit_sessions ADD CONSTRAINT audit_sessions_status_check
  CHECK (status IN ('Incomplete','PendingReview','Cancelled','Completed','Rejected'));
