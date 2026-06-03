# Shakti Supply Chain Management System — Implementation Tasks (Phase 2)

## How to read this document

This document is the build-ready task breakdown for the **second phase** of Shakti. It covers Section 2 of `Load_data_requirements.docx`: Payment Terminal Master, SIM Card Master, Base Station Master, and the Load Stock journey (file upload, field mapping, validation, error log).

**Hard constraints inherited from the source spec:**
- Phase 2 must be built **without changing any Phase 1 requirement, table, or route**. Phase 2 is additive: new tables, new endpoints, new screens. Existing Phase 1 endpoints, schemas, and seeds are not modified.
- **API-first**: every data-loading operation is exposed as a REST endpoint accepting either a multipart file upload or a structured JSON payload. The UI described in §5 is built on top of these endpoints — no UI-only operations.
- All Phase 1 Foundations (auth, soft-delete model, pincode lookup, change log, API parity, branding, responsive design, backup) carry forward unchanged and apply to every Phase 2 object.

Out-of-scope items are listed in the footer. Ambiguities are marked inline with `> NOTE:` when a reasonable default was chosen; resolved product decisions taken on the updated spec are recorded in §1.9.

---

## 1. Foundations (Phase 2)

### 1.1 Additive-only rule
- No Phase 1 source file may be edited as part of Phase 2 work. Phase 2 introduces:
  - New tables (Payment Terminal Master, SIM Card Master, Base Station Master, Load Attempts, Load Errors).
  - New routes under `/stock/...` and `/loads/...`.
  - New screens reachable from a **Load Stock** tab that renders only for the ADMIN role.
- Phase 2 may **read** Phase 1 tables (SKU, SKU Type, Vendor, Inventory Location, User) but must not alter their schemas or write paths.
- The only Phase 1 surface that gains a Phase 2 modification is the `change_log.object_type` enum, which is **appended** to (never reordered or removed) per §1.7.
- If a Phase 2 requirement appears to need an in-place Phase 1 change, halt and surface the conflict to product before implementing.

### 1.2 Admin-only loading workflow
- Per the updated source spec, Load Stock is an **ADMIN-only** workflow. SA cannot upload; STU and all other operational roles remain dormant in Phase 2.
- SA retains **read-only** access to the master objects (`GET /stock/...`) and to the attempt log (`GET /loads/attempts`) for oversight. SA cannot call `POST /loads/{kind}/preview` or `POST /loads/{kind}/commit`.
- ADMIN has full read + write on Phase 2 endpoints.
- The Load Stock top-level navigation entry renders **only** for ADMIN. SA and operational roles do not see it.

### 1.3 Present Location semantics (load-time vs Audit)
This subsection is the single source of truth for how `present_location`, `present_location_since`, and `last_audited_at` are handled across all three master objects. Every §2 / §3 / §4 reference back here.

- At load time, every Master row is created with:
  - `present_location_id = NULL`
  - `present_location_since = NULL`
  - `last_audited_at = NULL`
- The Audit journey (Phase 3, out of scope here) is responsible for populating `present_location_id` and `present_location_since` when an auditor confirms physical presence of a unit at a location. Until then, every loaded row's location is explicitly unknown.
- Because location is unknown at load, the load journey **does not require the uploading Admin to be tied to an Inventory Location**. The Phase 1 `users` table carries an optional `location_id` (added in `task1.md` §3) but this slice never reads, writes, or requires it — the load journey is location-agnostic. Phase 2 makes no schema change to the `users` table.
- The State default on load is per-Master (see §2 / §3 / §4):
  - Payment Terminal Master → `Working`.
  - SIM Card Master → `Active`.
  - Base Station Master → `Working`.

> NOTE: The source spec contains a contradiction inside §2.1 — the bulleted field list says Present Location is initially NULL while the "Validations when data is loaded" block says Location is set to the loading user's location. Product resolved this in favor of NULL-at-load (the bulleted rule). The "Validations" wording is treated as stale and is not implemented.

### 1.4 File upload service
- All load endpoints accept multipart `file` uploads with a JSON sidecar describing the field mapping.
- Accepted formats: **CSV (UTF-8)** with comma delimiter, first row as header. Max file size **10 MB**. Max rows per file **20 000**.

> NOTE: The source spec just says "file." CSV is the chosen baseline because it is the lowest-common-denominator and Phase 1 already handles PDF uploads for SKU specs. XLSX support is deferred. Override if XLSX must ship in Phase 2.

- Files are stored under a new `loads/` upload directory (separate from the Phase 1 `uploads/` directory used for SKU PDFs) for the duration of one load attempt, then retained for **30 days** alongside their error log, after which they are purged by a daily housekeeping job.
- File names are namespaced by `attempt_id` so two Admins uploading `stock.csv` simultaneously do not collide.

### 1.5 Field mapping contract
- Server-side endpoint `POST /loads/{kind}/preview` accepts the raw file and returns:
  - `headers`: array of detected column names from the file (in original order).
  - `suggested_mapping`: object mapping each target object field → the best-guess source header (or null when no confident match).
  - `target_fields`: array of `{ field, required, type }` describing what the object accepts.
- The client renders the mapping UI on top of this response. The client then calls `POST /loads/{kind}/commit` with `attempt_id`, `mapping` (explicit object field → source header), and the original file reference.
- Mapping rule: each target field maps to **at most one** source header; each source header maps to **at most one** target field (bijection enforced server-side, return 422 with the offending pair on violation).
- The "intelligent" suggestion engine in `preview` performs case-insensitive header normalization and synonym matching (e.g., `S.No`, `Serial No`, `Serial_Number` → `serial_number`). The synonym dictionary lives in code under `lib/loadMapping/synonyms.{kind}.js` (one file per master object) so adding synonyms is a one-line PR with no schema change.

### 1.6 Load attempt log
- Every `commit` call (whether it ends in success, partial success, or total failure) writes one row to a new `load_attempts` table:
  - `attempt_id` (uuid).
  - `kind` (enum: `payment_terminal`, `sim_card`, `base_station`).
  - `user_id` (FK → Users, the Admin who uploaded).
  - `file_name` (original client-side name, sanitized).
  - `stored_file_path` (server-side path under `loads/`).
  - `started_at`, `completed_at` (timestamps).
  - `rows_total`, `rows_loaded`, `rows_failed` (integers).
  - `status` (enum: `Success`, `PartialSuccess`, `Failure`).
  - `error_code` (string, nullable) — set only for file-level fatals (`file_invalid`, `too_many_rows`, `idempotency_conflict`). NULL for row-level failures; those are recorded in `load_errors` instead. See §6.2.
- Every row that failed validation writes one row to `load_errors`:
  - `load_error_id` (auto).
  - `attempt_id` (FK → `load_attempts`).
  - `row_number` (integer, 1-indexed against the source file; header counted as row 0).
  - `error_code` (enum: `sku_not_found`, `vendor_sku_not_found`, `vendor_sku_ambiguous`, `owner_not_found`, `duplicate_index`, `bad_format`, `required_missing`).
  - `error_message` (string, the exact wording from §6.1).
  - `raw_row` (text, the original CSV line for forensics).
- Per the source spec, **rows that pass validation are loaded** even when other rows in the same file failed. The attempt status is `PartialSuccess` whenever at least one row loaded and at least one row failed.

### 1.7 Change log integration
- Each loaded row writes one Phase 1 change-log entry with `action = Create` (no per-field diff, per Phase 1 §10). `object_type` is one of `PaymentTerminalMaster`, `SIMCardMaster`, `BaseStationMaster`.
- The change-log write happens inside the same transaction as the master insert; if the change-log insert fails, the master insert is rolled back (consistent with Phase 1 §10).
- Phase 1 §10 `object_type` enum gains three new values via a new additive migration. This is the only Phase 2 schema change that touches Phase 1 surface area; it is unavoidable because the change log is shared.

### 1.8 Authorization summary for Phase 2

| Endpoint                                              | SA      | Admin   | STU / other operational |
|-------------------------------------------------------|---------|---------|-------------------------|
| `POST /loads/{kind}/preview` / `commit`               | **403** | **200** | 403                     |
| `GET  /stock/payment-terminals`                       | **200** | **200** | 403                     |
| `GET  /stock/sim-cards`                               | **200** | **200** | 403                     |
| `GET  /stock/base-stations`                           | **200** | **200** | 403                     |
| `GET  /loads/attempts`, `GET /loads/attempts/{id}`    | **200** | **200** | 403                     |
| `GET  /loads/attempts/{id}/file`                      | **200** | **200** (own + others) | 403  |

- SA cannot upload; SA reads all stock and all attempts (including other Admins' attempts).
- Admin uploads and reads all stock; on `/loads/attempts`, Admin sees their own attempts and other Admins' attempts (no per-Admin filtering — the loading population is small and visibility is shared).

### 1.9 Resolved product decisions (from updated spec review)
- Actor for load journey: **ADMIN only**. STU role is **not** activated in Phase 2.
- `present_location_id` / `present_location_since` / `last_audited_at`: **NULL at load**; populated by Audit in Phase 3.
- All three Masters (Payment Terminal, SIM Card, Base Station) follow the same NULL-at-load rule. State default on load is per-Master (Working / Active / Working).
- §2.3 swapped from Accessories Master → **Base Station Master**, serial-indexed (mirrors Payment Terminal). Where §2.3 omits Date of Purchase / Owner / Last Audited Date, these are **inherited from Payment Terminal**.
- §2.4.1's stale reference to "accessories" is read as **Base Stations**.

---

## 2. Payment Terminal Master

### Fields & types
- `payment_terminal_master_id` (auto, internal).
- `sku_id` (FK → Phase 1 SKU, **required**; resolved at load time from the source file's **Vendor SKU Number** column together with the row's `owner` vendor — see §6.5 and Validation rules; SKU's type must be `Payment Terminal`).
- `sku_number_snapshot` (string, snapshot of the resolved SKU's `INN-NNNNN` code at load time — preserved across SKU renames).
- `sku_name_snapshot` (string, **derived** — copied from the resolved SKU; never read from the source file).
- `sku_description_snapshot` (string — taken from the source file's optional `description` column when supplied, otherwise copied from the resolved SKU's own description).
- `vendor_sku_number_snapshot` (string — the Vendor SKU number the row was matched/loaded under; lets View Stock show the Innoviti SKU ↔ Vendor SKU association).
- `date_of_purchase` (date, **required**; supplied by the source file).
- `owner_vendor_id` (FK → Phase 1 Vendor, **required**; resolved at load time from the source file's `owner` column).
- `serial_number` (string, **required**, 1–100 chars).
- `present_location_id` (FK → Phase 1 Inventory Location, **NULL on load**; populated by Phase 3 Audit).
- `present_location_since` (timestamp, **NULL on load**; populated by Phase 3 Audit).
- `last_audited_at` (timestamp, **NULL on load**; populated by Phase 3 Audit).
- `state` (enum: `Working`, `Retrieved Not Inspected`, `Installed`, `Under Repair`, `In Transit`, `Scrap`, `Loss`, `Repaired Not Inspected`; **set to `Working` on load**, never read from the file).
- `loaded_via_attempt_id` (FK → `load_attempts`, **required**; traces every row back to its origin upload).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Index / uniqueness
- Composite unique index `(sku_id, serial_number) WHERE deleted_at IS NULL`. A subsequent load with the same pair is rejected per §6.1 `duplicate_index`.

### API endpoints
- `POST /loads/payment-terminal/preview` — multipart file upload; returns headers + suggested mapping + target fields. ADMIN only.
- `POST /loads/payment-terminal/commit` — JSON: `{ attempt_id, mapping, file_ref }`. Performs validation row-by-row, loads passing rows, logs failures. Returns `{ attempt_id, status, rows_total, rows_loaded, rows_failed, errors: [...] }`. ADMIN only.
- `GET  /stock/payment-terminals` — list with filters `state`, `owner_vendor_id`, `sku_id`, `vendor_sku_number` (accepts the literal `null`), `date_of_purchase_from`/`_to`, `present_location_id` (filter accepts `present_location_id=null` to find unaudited rows). SA + Admin only.
- `GET  /stock/payment-terminals/{id}` — read one.
- `GET  /stock/payment-terminals/summary` — unit counts grouped by (Innoviti SKU × Vendor SKU) with a per-state breakdown; respects the same filters. Drives the View Stock roll-up. SA + Admin only.

**No POST/PATCH/DELETE on `/stock/payment-terminals` in Phase 2.** Master rows are created by load only; updates and state transitions ship in later-phase journeys (dispatch, retrieval, audit).

### Validation rules (at load time)
- `owner` (source file column): must resolve to an existing, non-soft-deleted Vendor. Match is **case-insensitive on `company_name`**. Otherwise → `owner_not_found`. The owner is resolved first because the SKU lookup below depends on it.
- `vendor_sku_number` (source file column): the row is identified by the **Vendor SKU Number**, not the Innoviti SKU number. It resolves to a Phase 1 SKU by matching the row's `owner` vendor **and** its `vendor_sku_number` against a non-deleted Vendor SKU row (`vendor_skus`, see Phase 1 §8.3.a) **and then** following any non-deleted `sku_vendor_links` (Phase 1 §8.3.b) from that Vendor SKU to an Innoviti SKU; the resolved Innoviti SKU's type must be `Payment Terminal`. If no Vendor SKU row matches → `vendor_sku_not_found`. If the Vendor SKU is not linked to any Innoviti SKU → also `vendor_sku_not_found`. If the owner + Vendor SKU Number pair leads to more than one Innoviti SKU (the same Vendor SKU is linked to several) → `vendor_sku_ambiguous` (the conflict is resolved on the Manage Vendor SKU screen).

> NOTE: The spec just says "Owner field must match an Owner value." Vendors have no field literally called "Owner" — `company_name` is the canonical human label. Override if vendor matching should use `vendor_index` (`VEN-NNNNN`) or a dedicated "Owner Name" alias instead.

- `serial_number`: required; 1–100 chars; whitespace trimmed; not blank.
- `date_of_purchase`: required; parsed as `YYYY-MM-DD` or `DD/MM/YYYY` (auto-detect); reject with `bad_format` otherwise.
- `description` (source file column, **optional**): free text captured into `sku_description_snapshot`. If unmapped or blank, the resolved SKU's own description is used instead.
- The SKU **name is not a source file column**. It is always derived from the resolved SKU. A file may contain a name/model column, but it is ignored — this prevents a wrong name from being silently accepted.
- Uniqueness: `(sku_id, serial_number)` must not exist in any non-deleted master row. Otherwise → `duplicate_index` ("{serial_number} of {sku_number} in {row} of {file} already exists in Shakti, not loaded").
- Server-set fields ignore file mapping: `present_location_id`, `present_location_since`, `last_audited_at`, `state`. If a mapping references one of these targets, the server silently drops the mapping, records a single info-level entry on the attempt ("server-set fields ignored: {fields}"), and proceeds with the load.

### Business rules / invariants
- Every loaded row is created in state `Working` with location fields NULL. State transitions and location assignment are Phase-3+ work.
- Soft delete on a master row hides it from default list responses but retains the index entry only when `deleted_at IS NOT NULL` (the unique index is partial on `deleted_at IS NULL`), so the same Serial can be reloaded if the prior row was soft-deleted.

### UI surface
- Reachable from **Load Stock → Load Terminal Data** (Admin nav).
- After file selection, the mapping UI renders source headers on the left and target object fields on the right with dropdowns; pre-populated by the `suggested_mapping` from `preview`.
- After mapping confirmation, the user clicks **Load**; the screen shows progress, then a result panel with `rows_loaded` / `rows_failed`, and a "View loading errors" link that deep-links to the Loading Errors tab filtered to this `attempt_id`.

### Cross-object dependencies (Phase 1)
- SKU with `sku_type.name = 'Payment Terminal'` must exist.
- Vendor must exist for every `owner` value in the file.

### Acceptance
- A 100-row CSV with 98 valid + 2 invalid rows loads 98 rows; attempt status is `PartialSuccess`; 2 errors are logged with correct row numbers and messages.
- Re-uploading the same file in full produces 0 loads and 100 `duplicate_index` errors.
- A row whose `owner` doesn't match any Vendor produces exactly one `owner_not_found` error; that row is not loaded.
- A row whose `vendor_sku_number` does not match any Vendor SKU row for its `owner` produces a `vendor_sku_not_found` error; that row is not loaded.
- After load, every loaded row's `present_location_id = NULL`, `present_location_since = NULL`, `last_audited_at = NULL`, and `state = 'Working'`.

---

## 3. SIM Card Master

### Fields & types
- `sim_card_master_id` (auto, internal).
- `sku_id` (FK → Phase 1 SKU where `sku_type.name = 'SIM Card'`, **required**).
- `sku_number_snapshot` (string snapshot of the SKU code at load time).
- `sku_name_snapshot` (string, **derived** from the SKU resolved by `sku_number`; never read from the file).
- `sku_description_snapshot` (string — from the file's optional `description` column when supplied, else the resolved SKU's own description).
- `vendor_sku_number_snapshot` (string — the Vendor SKU number the row was matched/loaded under; lets View Stock show the Innoviti SKU ↔ Vendor SKU association).
- `owner_vendor_id` (FK → Phase 1 Vendor, **required**; resolved at load time from the source file's `owner` column — mirrors Payment Terminal / Base Station Master). This is the supplying Vendor for the SIM unit; together with `vendor_sku_number` it uniquely identifies the Vendor SKU the unit was loaded under.
- `sim_card_number` (string, **required**, 1–50 chars).
- `date_of_purchase` (date, **optional**, **nullable**; from the source file's optional `date_of_purchase` column — mirrors Payment Terminal / Base Station Master). Accepts `YYYY-MM-DD` or `DD/MM/YYYY`; stored as a `DATE`. NULL when the row omits it.
- `vendor_sku_id` (FK → Vendor SKUs, **optional**, **nullable**). With `owner_vendor_id` now on the row, the loader can resolve `vendor_sku_id` from `(owner_vendor_id, vendor_sku_number)` exactly like PT and BS. Rows loaded **before** this resolution path is wired up keep `vendor_sku_id = NULL`; a future back-fill migration can populate them once the snapshot pair is reliably present.
- `present_location_id` (FK → Inventory Location, **NULL on load**; populated by Phase 3 Audit).
- `present_location_since` (timestamp, **NULL on load**).
- `last_audited_at` (timestamp, **NULL on load**).
- `state` (enum: `Inactive`, `Active`, `Blocked`, `Lost`; **set to `Active` on load**).
- `loaded_via_attempt_id` (FK → `load_attempts`, **required**; traces every row back to its origin upload).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Index / uniqueness
- Composite unique index `(sku_id, sim_card_number) WHERE deleted_at IS NULL`.

### API endpoints
- `POST /loads/sim-card/preview` — multipart file upload. ADMIN only.
- `POST /loads/sim-card/commit` — JSON. ADMIN only.
- `GET  /stock/sim-cards` — list with filters `state`, `sku_id`, `owner_vendor_id`, `vendor_sku_number` (accepts the literal `null`), `date_of_purchase_from` / `date_of_purchase_to`, `present_location_id` (including `present_location_id=null`). SA + Admin only. The `owner_vendor_id`, `vendor_sku_number`, and `date_of_purchase_from`/`_to` filters mirror Payment Terminal / Base Station Master.
- `GET  /stock/sim-cards/{id}` — read one.
- `GET  /stock/sim-cards/summary` — unit counts grouped by (Innoviti SKU × Vendor SKU) with a per-state breakdown, mirroring PT/BS. For SIM rows whose `vendor_sku_id` is still `NULL` (rows loaded before the loader was taught to resolve via `(owner, vendor_sku_number)`), the row lands in the NULL-Vendor-SKU group — same fall-back behaviour PT/BS already use.

### Validation rules (at load time)
- `owner` (source file column, **required**): must resolve to an existing, non-soft-deleted Vendor. Match is **case-insensitive on `company_name`**. Otherwise → `owner_not_found`. Resolved first because the SKU lookup below depends on it. Same rule as Payment Terminal / Base Station Master §2 / §4.
- `sku_number` (source file column): SIM Card loads identify the **Innoviti SKU** by `sku_number` (the SIM master continues to require a non-null `sku_id`). Must resolve to an existing, non-soft-deleted SKU whose SKU Type is `SIM Card`. Otherwise `sku_not_found`.
- `vendor_sku_number` (source file column, **optional during transition**): when supplied, resolves to a Vendor SKU row via `(owner_vendor_id, vendor_sku_number)` and populates `vendor_sku_id` + `vendor_sku_number_snapshot`. When omitted, the row loads with both Vendor-SKU columns left NULL — same fall-back PT/BS use for legacy rows. Once the SIM load template is updated to require `vendor_sku_number`, this field flips to **required** and reuses PT/BS error codes (`vendor_sku_not_found`, `vendor_sku_ambiguous`).
- `sim_card_number`: required; 1–50 chars; trimmed; not blank.
- `date_of_purchase` (source file column, **optional**): when supplied, must parse as `YYYY-MM-DD` or `DD/MM/YYYY`, else `bad_format`. When omitted or blank, stored as NULL. Same rule and error code as Payment Terminal / Base Station Master.
- `description` (source file column, **optional**): captured into `sku_description_snapshot`; falls back to the resolved SKU's description when unmapped or blank.
- The SKU **name is not a source file column** — always derived from the SKU resolved by `sku_number`; any name/model column in the file is ignored.
- Uniqueness: `(sku_id, sim_card_number)` not present in any non-deleted row. Otherwise `duplicate_index`. The `vendor_sku_id` and `owner_vendor_id` columns do **not** participate in the uniqueness rule — SIM identity remains keyed on Innoviti SKU + SIM number, to keep the existing index intact and avoid retroactive collisions on legacy rows.
- Server-set fields (`present_location_id`, `present_location_since`, `last_audited_at`, `state`) ignore any file mapping per §1.3.

### Business rules / invariants
- Every loaded row is created `Active` with location fields NULL.
- Soft delete behavior identical to Payment Terminal Master.

### UI surface
- Reachable from **Load Stock → Load SIM Card Data**. Mapping UI identical in structure to §2.

### Cross-object dependencies (Phase 1)
- SKU with `sku_type.name = 'SIM Card'` must exist.
- Vendor must exist for every `owner` value in the file (mirrors Payment Terminal / Base Station Master).

### Acceptance
- A row with a SIM number that already exists for the same SKU is rejected as `duplicate_index`.
- A row whose SKU resolves to a non-SIM-Card type is rejected as `sku_not_found`.
- A row whose `owner` doesn't match any Vendor produces exactly one `owner_not_found` error; that row is not loaded.
- A row whose `owner` resolves to a soft-deleted Vendor is also rejected as `owner_not_found`.
- A row that supplies a `vendor_sku_number` resolving against `(owner_vendor_id, vendor_sku_number)` populates `vendor_sku_id` + `vendor_sku_number_snapshot`; a row that omits `vendor_sku_number` loads successfully with both columns left NULL.
- A row that supplies a `date_of_purchase` in `YYYY-MM-DD` or `DD/MM/YYYY` stores it; an unparseable value is rejected as `bad_format`; an omitted value loads with `date_of_purchase = NULL`.
- All loaded rows have `state = 'Active'`, `present_location_id = NULL`, `last_audited_at = NULL`, and `owner_vendor_id` set to the resolved Vendor.

---

## 4. Base Station Master

Per the updated spec, §2.3 is now Base Station Master. Fields not explicitly listed in §2.3 (Date of Purchase, Owner, Last Audited Date) are **inherited from Payment Terminal Master** by product decision (§1.9). The object is serial-indexed exactly like Payment Terminal.

### Fields & types
- `base_station_master_id` (auto, internal).
- `sku_id` (FK → Phase 1 SKU where `sku_type.name = 'Base Station'`, **required**; resolved at load time from the file's **Vendor SKU Number** column together with the row's `owner` vendor — see §6.5 and Validation rules).
- `sku_number_snapshot` (string snapshot of the resolved SKU code at load time).
- `sku_name_snapshot` (string, **derived** from the resolved SKU; never read from the file).
- `sku_description_snapshot` (string — from the file's optional `description` column when supplied, else the resolved SKU's own description).
- `vendor_sku_number_snapshot` (string — the Vendor SKU number the row was matched/loaded under; **inherited from Payment Terminal**).
- `date_of_purchase` (date, **required**; supplied by the source file; **inherited from Payment Terminal**).
- `owner_vendor_id` (FK → Phase 1 Vendor, **required**; resolved from `owner` column; **inherited from Payment Terminal**).
- `serial_number` (string, **required**, 1–100 chars).
- `present_location_id` (FK → Inventory Location, **NULL on load**; populated by Phase 3 Audit).
- `present_location_since` (timestamp, **NULL on load**).
- `last_audited_at` (timestamp, **NULL on load**; **inherited from Payment Terminal**).
- `state` (enum: `Working`, `Retrieved Not Inspected`, `Installed`, `Under Repair`, `In Transit`, `Scrap`, `Loss`, `Repaired Not Inspected`; **set to `Working` on load**).
- `loaded_via_attempt_id` (FK → `load_attempts`, **required**; traces every row back to its origin upload).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Index / uniqueness
- Composite unique index `(sku_id, serial_number) WHERE deleted_at IS NULL`.

### API endpoints
- `POST /loads/base-station/preview` — multipart file upload. ADMIN only.
- `POST /loads/base-station/commit` — JSON. ADMIN only.
- `GET  /stock/base-stations` — list with filters `state`, `owner_vendor_id`, `sku_id`, `vendor_sku_number`, `date_of_purchase_from`/`_to`, `present_location_id`.
- `GET  /stock/base-stations/{id}` — read one.
- `GET  /stock/base-stations/summary` — unit counts grouped by (Innoviti SKU × Vendor SKU) with a per-state breakdown.

### Validation rules (at load time)
- `owner` (source file column): same rule as Payment Terminal — case-insensitive match against Vendor `company_name`; resolved first because the SKU lookup depends on it. No match → `owner_not_found`.
- `vendor_sku_number` (source file column): the row is identified by the **Vendor SKU Number**. It resolves to a Phase 1 SKU by matching the row's `owner` vendor **and** its `vendor_sku_number` against a non-deleted Vendor SKU row (`vendor_skus`, see Phase 1 §8.3.a) **and then** following any non-deleted `sku_vendor_links` (Phase 1 §8.3.b) from that Vendor SKU to an Innoviti SKU; the resolved Innoviti SKU's type must be `Base Station`. No match → `vendor_sku_not_found` (also raised when the Vendor SKU has no live link to any Innoviti SKU); an owner + Vendor SKU Number pair that leads to more than one Innoviti SKU → `vendor_sku_ambiguous`.
- `description` (source file column, **optional**): captured into `sku_description_snapshot`; falls back to the resolved SKU's description when unmapped or blank.
- The SKU **name is not a source file column** — always derived from the resolved SKU; any name/model column in the file is ignored.
- `serial_number`: required; 1–100 chars; trimmed; not blank.
- `date_of_purchase`: required; same date-parsing rule as Payment Terminal.
- Uniqueness: `(sku_id, serial_number)` not present in any non-deleted row. Otherwise `duplicate_index`.
- Server-set fields ignore file mapping per §1.3.

### Business rules / invariants
- Every loaded row is created in state `Working` with location fields NULL.
- Identical soft-delete and re-load semantics as Payment Terminal Master.

### UI surface
- Reachable from **Load Stock → Load Base Station Data**. Mapping UI structurally identical to §2.

### Cross-object dependencies (Phase 1)
- SKU with `sku_type.name = 'Base Station'` must exist. Per Phase 1 §7, `Base Station` is a seeded SKU Type with `serial_eligible = true`.
- Vendor must exist for every `owner` value in the file.

### Acceptance
- A 50-row CSV with 50 valid Base Station rows loads 50 rows; all have `state='Working'`, location fields NULL.
- Loading via a Vendor SKU Number that belongs to a non-Base-Station SKU returns `vendor_sku_not_found` (no Base Station Vendor SKU row matches the owner + Vendor SKU Number) and is not stored.
- Re-uploading the same file produces 0 loads and N `duplicate_index` errors.

---

## 5. Load Stock Journey (UI + cross-cutting flow)

### Page layout
- A new top-level nav entry **Load Stock**, rendered only for ADMIN. SA and operational roles do not see it.
- The Load Stock page hosts a **secondary tab bar** with exactly four tabs, in this order:
  1. Load Terminal Data
  2. Load SIM Card Data
  3. Load Base Station Data
  4. Loading Errors
- The top-level nav (Phase 1 chrome) continues to render above the secondary tab bar so Admin can sign out and view their identity panel.

### Upload widget
- Each of the first three tabs renders a single drag-and-drop / click-to-browse zone.
- File picker accepts `.csv` only; client-side rejects non-CSV with a friendly inline message before any network call.
- After file selection:
  1. Client calls `POST /loads/{kind}/preview` with the file. Server returns `headers`, `suggested_mapping`, `target_fields`.
  2. Client renders the mapping panel: source headers on the left (one row per header), target fields on the right, each with a dropdown of source headers (pre-selected from `suggested_mapping`, or blank when unmapped).
  3. Client enforces the bijection rule: picking header `H` for target `T2` unselects it from target `T1` automatically.
  4. User clicks **Load**; client calls `POST /loads/{kind}/commit`. The button is disabled until every required target field is mapped.
- Server response surfaces:
  - Total rows in file, rows loaded, rows failed.
  - Inline "View loading errors" link → Loading Errors tab filtered to this `attempt_id`.

### Loading Errors tab
- Lists every `load_attempts` row newest first, with columns: timestamp, file name, kind, rows_loaded, rows_failed, status, uploader.
- Each row's `attempt_id` is a hyperlink → detail view listing every `load_errors` row for that attempt with row number, error code, message, and raw CSV line.
- The detail view is shareable via URL (the `attempt_id` is in the path) so any Admin or SA can open it directly.

### Accessibility & responsive
- Page conforms to Phase 1 §1.3 responsive breakpoints. The mapping panel collapses to single-column stacking ≤640px.
- Drag-and-drop has a keyboard-equivalent file picker (clicking the zone opens the OS file dialog).

### API parity
- The drag-and-drop UI is purely a wrapper around `preview` and `commit`. A CLI or external script can drive a load by hitting the same two endpoints.

---

## 6. Validation Rules (consolidated)

### 6.1 Error code → user-facing message
The exact wording is preserved from the source spec because the spec quotes them as the user-visible strings.

| Code                  | Message template                                                                                                                |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------|
| `sku_not_found`       | `SKU number in {row_number} of {file_name} not found in Shakti, create SKU part or correct file`                               |
| `vendor_sku_not_found`| `Vendor SKU number "{vendor_sku_number}" for owner {owner} in row {row_number} of {file_name} not found in Shakti — add the vendor SKU row or correct the file` |
| `vendor_sku_ambiguous`| `Vendor SKU number "{vendor_sku_number}" for owner {owner} in row {row_number} of {file_name} matches more than one Innoviti SKU — resolve the conflict in Manage Vendor SKU` |
| `owner_not_found`     | `Owner in row {row_number} of file {file_name} not found in Shakti, create Owner or correct file`                              |
| `duplicate_index`     | `{serial_or_sim_number} of {sku_number} in {row_number} of {file_name} already exists in Shakti, not loaded`                   |
| `required_missing`    | `Required field '{field}' missing in row {row_number} of {file_name}`                                                          |
| `bad_format`          | `Value '{raw_value}' for '{field}' in row {row_number} of {file_name} is not a valid {expected_type}`                          |

### 6.2 Partial-load contract
- Validation is performed row-by-row inside a single commit transaction per row.
- A failing row does not abort the attempt. All passing rows are persisted; all failing rows are logged.
- The attempt's final `status` is:
  - `Success` if `rows_failed = 0`.
  - `PartialSuccess` if `rows_loaded > 0 AND rows_failed > 0`.
  - `Failure` if `rows_loaded = 0`.
- File-level fatal errors (file not parseable as CSV, exceeds size cap, exceeds row cap) abort before row iteration; no rows load and no `load_errors` rows are written. The failure is recorded on the `load_attempts` row itself with `error_code = 'file_invalid'`.

### 6.3 Server-only field guard
- For any load kind, server-set fields (`present_location_id`, `present_location_since`, `last_audited_at`, `state`) ignore any client-supplied mapping. If a mapping references one of these targets, the server silently drops the mapping, records a single info-level entry on the attempt ("server-set fields ignored: {fields}"), and proceeds with the load.

### 6.4 Idempotency
- A `commit` call carries a client-generated `Idempotency-Key` header. Re-posting the same key with the same body returns the original attempt's response without re-running validation. Re-posting the same key with a different body returns HTTP 409 `idempotency_conflict`.

> NOTE: The source spec does not address browser-retry / double-submit semantics. Added defensively to remove a foreseeable support issue. Override to drop if not wanted in Phase 2.

### 6.5 SKU resolution key (per kind)
How each loaded row is matched to a Phase 1 Innoviti SKU differs by kind:

- **Payment Terminal & Base Station** — each row is identified by its **Vendor SKU Number**, not the Innoviti SKU number. The loader resolves the SKU in two hops: first match the row's `owner` (vendor) **together with** its `vendor_sku_number` against `vendor_skus` (Phase 1 §8.3.a, non-deleted); then follow any non-deleted `sku_vendor_links` rows (Phase 1 §8.3.b) from that Vendor SKU to its Innoviti SKU(s). A Vendor SKU Number is **not globally unique** across vendors, so the `owner` is required to disambiguate — the owner is therefore resolved before the Vendor SKU lookup. Outcomes:
  - no Vendor SKU row matches the owner + Vendor SKU Number → `vendor_sku_not_found`;
  - the Vendor SKU exists but is not linked to any Innoviti SKU → also `vendor_sku_not_found`;
  - the Vendor SKU is linked to more than one Innoviti SKU → `vendor_sku_ambiguous` (resolved on the Manage Vendor SKU screen);
  - the resolved Innoviti SKU's type must still be the kind's expected type (`Payment Terminal` / `Base Station`).
- **SIM Card** — each row is identified directly by the **Innoviti SKU number** (`sku_number`). SIM card files carry no `owner` column, so vendor-SKU disambiguation is unavailable; the Innoviti SKU number is matched as-is against `skus.sku_number`.

The CSV template headers reflect this: Payment Terminal and Base Station templates lead with a `vendor_sku_number` column; the SIM Card template keeps `sku_number`.

---

## 7. Loading Errors (object)

### Fields & types
- `load_error_id` (auto).
- `attempt_id` (FK → `load_attempts`).
- `row_number` (integer, 1-indexed; header is row 0).
- `error_code` (enum, §6.1).
- `error_message` (string, fully rendered per §6.1 templates with placeholders substituted).
- `raw_row` (text — verbatim source CSV line).
- `created_at` (timestamp).

### API endpoints
- `GET /loads/attempts` — list of all attempts visible to the caller (Admin sees all attempts; SA sees all attempts). Filters: `kind`, `status`, `started_at_from`/`_to`, `user_id`.
- `GET /loads/attempts/{attempt_id}` — single attempt with summary counters and `errors` array.
- `GET /loads/attempts/{attempt_id}/file` — download the original uploaded file (retention 30 days; SA or any Admin).

### Business rules / invariants
- `load_attempts` and `load_errors` rows are read-only via API. There is no admin "edit error" or "rerun attempt" affordance in Phase 2 (rerunning is just re-uploading the corrected file).
- A daily housekeeping job deletes `load_attempts` (and their `load_errors` and stored files) older than 30 days.

### UI surface
- Loading Errors tab, as described in §5.

### Acceptance
- An attempt with 0 failures still has a `load_attempts` row.
- Deleting an attempt via the housekeeping job (>30 days) cascades to its `load_errors` rows.
- Any Admin or SA can fetch any attempt's detail.

---

## 8. Change-log integration (cross-cutting recap)

- A successful row load writes one Phase 1 change-log row with `action = Create`, `object_type ∈ { PaymentTerminalMaster, SIMCardMaster, BaseStationMaster }`, `object_id` set to the master row's primary key.
- File-level failures write **no** change-log rows (no master mutations happened).

Phase 1 §10 enum gains three new `object_type` values via a new additive migration. No existing enum value is renamed or removed.

---

## Open product questions (still pending)

The four critical ambiguities raised on the updated doc were resolved (recorded in §1.9). These remain open with a chosen default; override at any point and the docs will be patched before any code lands:

1. **Vendor "Owner" match key** — chose `vendor.company_name`, case-insensitive. (§2 / §4 validation, §6.1)
2. **File format scope** — chose CSV only for Phase 2; XLSX deferred. (§1.4)
3. **Mapping persistence** — per-upload only; no saved mapping templates. (§5)
4. **Re-load after soft-delete** — the unique index excludes soft-deleted rows, so the same Serial can be reloaded after a soft-delete. (§2 / §4)
5. **Idempotency-Key** — added defensively; not requested by spec. (§6.4)
6. **`/loads/attempts` visibility** — Admin sees all Admins' attempts (no per-uploader filter). The loading population is small; shared visibility was preferred over isolation. Override to STU-style isolation if needed.

---

## Out of scope for this phase

- State transitions on master rows (Working → Installed → Retrieved Not Inspected → Under Repair → Repaired Not Inspected → In Transit / Scrap / Loss etc.) — Phase 3 dispatch/retrieval/audit journeys own those.
- **Audit journey** — the only mechanism that populates `present_location_id`, `present_location_since`, and `last_audited_at` on any master row. Phase 3.
- Edit/delete affordances on master rows (no PATCH/DELETE endpoints in Phase 2).
- Accessories Master object — removed from the updated spec; no Phase 2 work.
- XLSX file uploads.
- Saved mapping templates / per-vendor mapping presets.
- STU role activation — STU and other operational roles remain dormant.
- Concurrent multi-file batch uploads under one attempt.
- Auto-creation of missing SKUs or Vendors from the source file (the spec explicitly requires the user to create them in Phase 1 screens first).
- Bulk re-validation or re-load of older failed attempts.
- Email/alerting on failed loads.
- All other journeys named in `Object_requirements.docx` (orders, dispatch, retrieval, MIS).
