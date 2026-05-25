-- Shakti Phase 2 schema (Load Stock journey + 3 Master objects)
-- ADDITIVE ONLY. Does not modify any Phase 1 table, index, or constraint.

-- =====================================================================
-- Load attempts: one row per file upload commit (success or failure).
-- =====================================================================
CREATE TABLE IF NOT EXISTS load_attempts (
  attempt_id       TEXT PRIMARY KEY,                       -- uuid
  kind             TEXT NOT NULL,                          -- payment_terminal | sim_card | base_station
  user_id          INTEGER NOT NULL REFERENCES users(user_id),
  user_index       TEXT,                                   -- denormalized snapshot
  file_name        TEXT NOT NULL,
  stored_file_path TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  rows_total       INTEGER NOT NULL DEFAULT 0,
  rows_loaded      INTEGER NOT NULL DEFAULT 0,
  rows_failed      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'Pending',        -- Pending | Success | PartialSuccess | Failure
  fatal_error_code TEXT,                                   -- e.g. 'file_invalid' when file-level abort
  fatal_error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_load_attempts_user ON load_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_load_attempts_kind ON load_attempts(kind);
CREATE INDEX IF NOT EXISTS idx_load_attempts_time ON load_attempts(started_at);

-- =====================================================================
-- Load errors: one row per failed source-file row.
-- =====================================================================
CREATE TABLE IF NOT EXISTS load_errors (
  load_error_id BIGSERIAL PRIMARY KEY,
  attempt_id    TEXT NOT NULL REFERENCES load_attempts(attempt_id) ON DELETE CASCADE,
  row_number    INTEGER NOT NULL,                          -- 1-indexed; header is row 0
  error_code    TEXT NOT NULL,
  error_message TEXT NOT NULL,
  raw_row       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_load_errors_attempt ON load_errors(attempt_id);

-- =====================================================================
-- Payment Terminal Master (serial-indexed).
-- present_location_id / present_location_since / last_audited_at are
-- NULL on load by product decision; Phase 3 Audit populates them.
-- =====================================================================
CREATE TABLE IF NOT EXISTS payment_terminal_master (
  payment_terminal_master_id SERIAL PRIMARY KEY,
  sku_id                     INTEGER NOT NULL REFERENCES skus(sku_id),
  sku_number_snapshot        TEXT NOT NULL,
  sku_name_snapshot          TEXT,
  sku_description_snapshot   TEXT,
  date_of_purchase           DATE NOT NULL,
  owner_vendor_id            INTEGER NOT NULL REFERENCES vendors(vendor_id),
  serial_number              TEXT NOT NULL,
  vendor_sku_number_snapshot TEXT,                          -- vendor SKU the row was loaded under
  present_location_id        INTEGER REFERENCES locations(location_id),
  present_location_since     TIMESTAMPTZ,
  last_audited_at            TIMESTAMPTZ,
  state                      TEXT NOT NULL DEFAULT 'Working',
  loaded_via_attempt_id      TEXT NOT NULL REFERENCES load_attempts(attempt_id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                 TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptm_sku_serial
  ON payment_terminal_master (sku_id, serial_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ptm_state    ON payment_terminal_master(state);
CREATE INDEX IF NOT EXISTS idx_ptm_owner    ON payment_terminal_master(owner_vendor_id);
CREATE INDEX IF NOT EXISTS idx_ptm_location ON payment_terminal_master(present_location_id);

-- =====================================================================
-- SIM Card Master (sim-card-number-indexed).
-- =====================================================================
CREATE TABLE IF NOT EXISTS sim_card_master (
  sim_card_master_id       SERIAL PRIMARY KEY,
  sku_id                   INTEGER NOT NULL REFERENCES skus(sku_id),
  sku_number_snapshot      TEXT NOT NULL,
  sku_name_snapshot        TEXT,
  sku_description_snapshot TEXT,
  sim_card_number          TEXT NOT NULL,
  present_location_id      INTEGER REFERENCES locations(location_id),
  present_location_since   TIMESTAMPTZ,
  last_audited_at          TIMESTAMPTZ,
  state                    TEXT NOT NULL DEFAULT 'Active',
  loaded_via_attempt_id    TEXT NOT NULL REFERENCES load_attempts(attempt_id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scm_sku_simnum
  ON sim_card_master (sku_id, sim_card_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scm_state    ON sim_card_master(state);
CREATE INDEX IF NOT EXISTS idx_scm_location ON sim_card_master(present_location_id);

-- =====================================================================
-- Base Station Master (serial-indexed; mirrors Payment Terminal per
-- product decision when §2.3 omitted Date of Purchase / Owner / Last
-- Audited Date).
-- =====================================================================
CREATE TABLE IF NOT EXISTS base_station_master (
  base_station_master_id   SERIAL PRIMARY KEY,
  sku_id                   INTEGER NOT NULL REFERENCES skus(sku_id),
  sku_number_snapshot      TEXT NOT NULL,
  sku_name_snapshot        TEXT,
  sku_description_snapshot TEXT,
  date_of_purchase         DATE NOT NULL,
  owner_vendor_id          INTEGER NOT NULL REFERENCES vendors(vendor_id),
  serial_number            TEXT NOT NULL,
  vendor_sku_number_snapshot TEXT,                          -- vendor SKU the row was loaded under
  present_location_id      INTEGER REFERENCES locations(location_id),
  present_location_since   TIMESTAMPTZ,
  last_audited_at          TIMESTAMPTZ,
  state                    TEXT NOT NULL DEFAULT 'Working',
  loaded_via_attempt_id    TEXT NOT NULL REFERENCES load_attempts(attempt_id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bsm_sku_serial
  ON base_station_master (sku_id, serial_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bsm_state    ON base_station_master(state);
CREATE INDEX IF NOT EXISTS idx_bsm_owner    ON base_station_master(owner_vendor_id);
CREATE INDEX IF NOT EXISTS idx_bsm_location ON base_station_master(present_location_id);
