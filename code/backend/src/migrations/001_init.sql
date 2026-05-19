-- Shakti 2.0 schema (Postgres)

CREATE TABLE IF NOT EXISTS user_types (
  user_type_id   SERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  is_seed        BOOLEAN NOT NULL DEFAULT FALSE,
  is_immutable   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vendor_types (
  vendor_type_id SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  is_seed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_types_name_ci
  ON vendor_types (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id      SERIAL PRIMARY KEY,
  vendor_index   TEXT NOT NULL UNIQUE,
  company_name   TEXT NOT NULL,
  vendor_type_id INTEGER NOT NULL REFERENCES vendor_types(vendor_type_id),
  gst_number     TEXT,
  reg_line_1     TEXT,
  reg_line_2     TEXT,
  reg_pincode    TEXT,
  reg_city       TEXT,
  reg_state      TEXT,
  op_line_1      TEXT,
  op_line_2      TEXT,
  op_pincode     TEXT,
  op_city        TEXT,
  op_state       TEXT,
  status         TEXT NOT NULL DEFAULT 'Active',
  is_seed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_gst_unique
  ON vendors(gst_number) WHERE gst_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  user_index     TEXT NOT NULL UNIQUE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  user_type_id   INTEGER NOT NULL REFERENCES user_types(user_type_id),
  email          TEXT NOT NULL,
  password_hash  TEXT,
  mobile         TEXT,
  vendor_id      INTEGER REFERENCES vendors(vendor_id),
  employee_id    TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  pincode        TEXT,
  city           TEXT,
  state          TEXT,
  status         TEXT NOT NULL DEFAULT 'Active',
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci
  ON users (LOWER(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id
  ON users(employee_id) WHERE employee_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contacts (
  contact_id     SERIAL PRIMARY KEY,
  contact_index  TEXT NOT NULL UNIQUE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT NOT NULL,
  mobile         TEXT,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(vendor_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sku_types (
  sku_type_id    SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  serial_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  is_seed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_types_name_ci
  ON sku_types (LOWER(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS terminal_parent_skus (
  parent_sku_id     SERIAL PRIMARY KEY,
  parent_sku_number TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tps_name_ci ON terminal_parent_skus (LOWER(name));

CREATE TABLE IF NOT EXISTS skus (
  sku_id              SERIAL PRIMARY KEY,
  sku_number          TEXT NOT NULL UNIQUE,
  sku_name            TEXT NOT NULL,
  description         TEXT,
  stm                 TEXT NOT NULL,
  sku_type_id         INTEGER NOT NULL REFERENCES sku_types(sku_type_id),
  specifications_pdf  TEXT,
  approx_price_moq    INTEGER,
  approx_price_unit   NUMERIC,
  status              TEXT NOT NULL DEFAULT 'Active',
  parent_sku_id       INTEGER REFERENCES terminal_parent_skus(parent_sku_id),
  adaptor_sku_ids     JSONB,
  usb_cable_sku_ids   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sku_vendor_assocs (
  sku_vendor_assoc_id         SERIAL PRIMARY KEY,
  sku_id                      INTEGER NOT NULL REFERENCES skus(sku_id),
  vendor_id                   INTEGER NOT NULL REFERENCES vendors(vendor_id),
  vendor_sku_number           TEXT NOT NULL,
  vendor_sku_specification_pdf TEXT,
  vendor_sku_price_moq        INTEGER,
  vendor_sku_price_unit       NUMERIC,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sva_unique
  ON sku_vendor_assocs(sku_id, vendor_id, vendor_sku_number) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS locations (
  location_id          SERIAL PRIMARY KEY,
  location_index       TEXT NOT NULL UNIQUE,
  vendor_id            INTEGER NOT NULL REFERENCES vendors(vendor_id),
  location_name        TEXT NOT NULL,
  address_line_1       TEXT,
  address_line_2       TEXT,
  pincode              TEXT,
  city                 TEXT,
  state                TEXT,
  principal_contact_id INTEGER NOT NULL REFERENCES contacts(contact_id),
  secondary_contact_id INTEGER REFERENCES contacts(contact_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS change_log (
  change_log_id     BIGSERIAL PRIMARY KEY,
  object_type       TEXT NOT NULL,
  object_id         TEXT NOT NULL,
  actor_user_id     INTEGER REFERENCES users(user_id),
  actor_user_index  TEXT,
  action            TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_change_log_object ON change_log(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_change_log_actor ON change_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_time ON change_log(occurred_at);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(user_id),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token           TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(user_id),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  invalidated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counters (
  name   TEXT PRIMARY KEY,
  value  BIGINT NOT NULL
);
