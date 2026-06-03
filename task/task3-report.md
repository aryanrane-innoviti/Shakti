# Shakti Supply Chain Management System — Implementation Tasks (Phase 3, Audit Report slice)

## How to read this document

This document is the build-ready task breakdown for the **Audit Report module** that closes the audit loop in Phase 3 of Shakti. It covers exactly what `docs/Audit_Report.docx` §3.3 specifies: how an Admin (and, for ASO reports, an STU) lists, reviews, cancels, approves, or rejects a Provisional Audit Report (PAR); how per-row reviewer decisions roll up to an overall report status; how an Approved report writes its findings back into the Master tables and `accessory_stock_balances`; and how an Approved report becomes a downloadable PDF.

It deliberately **excludes**:
- The ASO auditor journey (`docs/Audit_Aso_User.docx` → `task/task3-aso.md`).
- The STU auditor journey (`docs/Audit_Store_User.docx` → `task/task3-stu.md`).
- Any non-audit Phase 3 work.

**Hard constraints inherited from prior phases:**
- **Built strictly on top** of what `task1.md`, `task2.md`, `task3-aso.md`, and `task3-stu.md` define. No requirement, table, route, or seed value from those four files is restructured. The Report slice is **additive**: new endpoints, new screens, four new nullable columns on existing Phase 3 row tables, and one widened CHECK constraint on each of two existing Phase 3 status enums (described in §1.3) — both DDL operations are strictly value-permitting (no existing row becomes invalid).
- The ASO and STU slices each parked their `PendingReview → terminal` transition as out-of-scope; the Report slice is what owns those transitions and the corresponding write-back to Phase 1/2 Master tables (`payment_terminal_master.{present_location_id, present_location_since, last_audited_at}`, `base_station_master.*`, `sim_card_master.*` — Phase 2 §1.3 created those columns NULL-at-load *specifically* for this purpose).
- The ASO slice's `accessory_stock_balances` table (introduced in migration 014, `task3-aso.md` §5.2) is **written** by this slice on the Approved transition. The slice continues to read it during seeding (handled in ASO/STU) — no schema change to that table.
- **API-first**: every report operation — listing, opening one, cancelling, per-row review, submit, downloading the PDF — is a REST endpoint. The UI in §9 is a thin client over those endpoints.
- All Phase 1 Foundations (auth, soft-delete, change log, API parity, branding, responsive design, backup) carry forward unchanged.

If a Phase 3 Report requirement appears to need an in-place change to Phase 1/2 schema beyond the documented write-backs, halt and surface the conflict to product before implementing.

Out-of-scope items are listed in the footer. Ambiguities are marked inline with `> NOTE:` when a reasonable default was chosen; resolved product decisions are recorded in §1.9.

---

## 1. Foundations (Phase 3 / Report)

### 1.1 Additive-only rule
- No Phase 1 or Phase 2 source file is restructured. The two write-backs to existing tables (Master tables, `accessory_stock_balances`) populate columns whose values are already nullable / settable — no DDL.
- New things introduced in this slice:
  - One new migration (`017_phase3_report.sql` — numbered after the STU slice's `016_phase3_stu.sql`).
  - Four nullable columns appended to **each** of the four existing Phase 3 row tables (`audit_session_serial_rows`, `audit_session_accessory_rows`, `store_audit_serial_rows`, `store_audit_accessory_rows`): `reviewer_status`, `reviewer_remarks`, `reviewed_at`, `reviewed_by_user_id`. All four are NULL on insert; all four are set per-row when an Admin/STU submits a report verdict.
  - One widened `CHECK` constraint on **each** of `audit_sessions.status` and `store_audit_sessions.status` to permit the new `Rejected` terminal value (see §1.3). The existing `Completed` value continues to mean "Approved + written back" — no rename, no semantic drift.
  - New routes under `/audit-reports/...`.
  - A new top-level **Audit Reports** nav entry rendered for users whose `user_type_code` is `ADMIN`, `SA`, or `STU` (per the activation matrix below).
- The Report slice **reads** every Phase 1/2/3 table needed to render and roll up a report (`users`, `locations`, `vendors`, the three Master tables, `audit_sessions` + its row tables, `store_audit_sessions` + its row tables, `accessory_stock_balances`) and **writes** to the four targets listed in §1.6 only on the Approved transition.

### 1.2 Activation matrix
- **Admin (`ADMIN`)** — reviews **both** ASO and STU reports. Sees every PAR regardless of auditor's user type. Per spec §3.3.2 (the Admin variant). The full set of report actions is available: list, open, cancel-Incomplete, per-row review, Submit, download.
- **Store User (`STU`)** — reviews **only ASO** reports. STU does **not** see STU reports (their own, or any peer STU's) in this screen. Per spec §3.3.1. The same set of report actions is available, but the list is filtered to ASO-authored PARs.
- **Service Admin (`SA`)** — read-only oversight. Can list all reports (both kinds) and open any in read-only mode; cannot Cancel, Review, Submit, or alter row decisions. The spec does not enumerate SA explicitly — read-only access mirrors the Phase 1/2 "SA reads everything, writes nothing operational" convention.
- **ASO (`ASO`)** — **no access** to this screen. The ASO's own audit history is visible to them only inside the existing `/audit` page (Phase 3 ASO §6), not under Audit Reports.
- All other operational user types (ALU, RLU, FNU, LOU) remain dormant.
- Route-level activation: a new `requireReportReader()` middleware (appended to `lib/auth.js` next to `requireAso` / `requireStu`) gates list / read; a stricter `requireReportReviewer()` gates Cancel / row-PATCH / Submit. The two middlewares filter on `user_type_code`:
  - `requireReportReader` admits `ADMIN`, `SA`, `STU`.
  - `requireReportReviewer` admits `ADMIN`, `STU` (SA is read-only).
- No existing middleware is edited; both helpers are append-only.

### 1.3 Status model — DB enums vs UI labels

The spec uses five status labels: **Pending, Incomplete, Approved, Rejected, Cancelled**. The DB stores five values: `Incomplete`, `PendingReview`, `Cancelled`, `Completed`, `Rejected`. The mapping:

| Spec label   | DB value         | Meaning                                                                                                           |
|--------------|------------------|-------------------------------------------------------------------------------------------------------------------|
| `Incomplete` | `Incomplete`     | Auditor has not yet pressed Complete. The Reports screen renders a Cancel button only (no row review).            |
| `Pending`    | `PendingReview`  | Auditor pressed Complete. Awaiting reviewer. The Reports screen renders the per-row review interface.             |
| `Approved`   | `Completed`      | Reviewer Submitted with every row Approved. Write-backs to Masters and `accessory_stock_balances` ran (§1.6).     |
| `Rejected`   | `Rejected`       | Reviewer Submitted with at least one row Rejected. **No** write-back ran.                                         |
| `Cancelled`  | `Cancelled`      | Either the auditor cancelled mid-audit (Phase 3 ASO/STU `cancel` endpoint) **or** a reviewer cancelled the report while it was still `Incomplete` (this slice). Soft-deleted; PAR not retained for reporting. |

**Why `Completed` continues to mean Approved**: the ASO and STU slices already use `Completed` to mark the closed-loop terminal state. Renaming it to `Approved` would be a destructive rename. Keeping `Completed` in the DB and rendering it as `Approved` in the UI is the only additive option and preserves every existing query / index / type / response shape.

**The one DDL change Phase 3 Report introduces**: each `status` CHECK constraint gains the `Rejected` value.

```sql
ALTER TABLE audit_sessions DROP CONSTRAINT IF EXISTS audit_sessions_status_check;
ALTER TABLE audit_sessions ADD CONSTRAINT audit_sessions_status_check
  CHECK (status IN ('Incomplete','PendingReview','Cancelled','Completed','Rejected'));

ALTER TABLE store_audit_sessions DROP CONSTRAINT IF EXISTS store_audit_sessions_status_check;
ALTER TABLE store_audit_sessions ADD CONSTRAINT store_audit_sessions_status_check
  CHECK (status IN ('Incomplete','PendingReview','Cancelled','Completed','Rejected'));
```

Strictly value-permitting: no existing row's value becomes invalid. Idempotent — both `DROP CONSTRAINT IF EXISTS` and `ADD CONSTRAINT` work on re-boot.

### 1.4 Per-row auto-status computation

A row's effective status when the Reports screen renders is computed deterministically from the existing row fields plus the persisted reviewer columns (see §1.5). The spec's auto-approve rules:

- **Serial row** is auto-`Approved` when **both**:
  - `matched = true` (a scan hit the expected row, or the row was created Unexpected/Unregistered — every category that the auditor "counted" sets matched=true at scan time), **and**
  - `remarks IS NULL` or trimmed-empty.
- **Accessory row** is auto-`Approved` when:
  - `missing_count IS NOT NULL` (i.e., the table was Submitted by the auditor, so `missing_count` was computed) **and** `missing_count <= 0` — i.e., the auditor found at least the expected quantity, possibly more. (The current `audit_session_accessory_rows.missing_count` is clamped to 0 in the auditor's submit step, per `task3-aso.md` §4 NOTE; a CHECK constraint guarantees it is never negative when stored. The `<= 0` framing matches the spec's wording verbatim — "zero or less than zero" — and is robust if the clamp is later relaxed.)
- All other rows default to **Pending** until the reviewer explicitly sets `reviewer_status`.

**Auto-status is never persisted.** It's computed in the API response and in the UI. The only persisted reviewer state is what the reviewer themselves writes (§1.5).

### 1.5 Per-row reviewer state (the four new columns)

Added to **each** of `audit_session_serial_rows`, `audit_session_accessory_rows`, `store_audit_serial_rows`, `store_audit_accessory_rows`:

| Column                  | Type / nullability                                                                       | Meaning |
|-------------------------|-------------------------------------------------------------------------------------------|---------|
| `reviewer_status`       | `TEXT NULL CHECK (reviewer_status IS NULL OR reviewer_status IN ('Approved','Rejected'))`| The reviewer's explicit decision for this row. NULL until they touch the row. |
| `reviewer_remarks`      | `TEXT NULL`                                                                              | Free text from the reviewer; capped at 500 chars; newlines collapsed to space. |
| `reviewed_at`           | `TIMESTAMPTZ NULL`                                                                       | Timestamp of the most recent `reviewer_status` write.                          |
| `reviewed_by_user_id`   | `INTEGER NULL REFERENCES users(user_id)`                                                 | The reviewer who set this row's `reviewer_status`. NULL until set.             |

All four columns are added in one migration (`017_phase3_report.sql`) via idempotent `ADD COLUMN IF NOT EXISTS`. Existing rows retain NULL — no back-fill needed, the auto-status rule covers them at read time. No new index — the columns are scanned during a single report rollup, never as a primary filter.

**Effective row status**, returned on every report read:

```
if reviewer_status IS NOT NULL → reviewer_status      -- reviewer's explicit decision wins
else if auto-approve rule applies → 'Approved'        -- auto-computed
else → 'Pending'                                       -- awaiting review
```

The reviewer can **un-set** their decision by sending `reviewer_status: null` in the PATCH; the row falls back to auto-computed.

### 1.6 Overall report status & Approved-side-effects (write-back)

When the reviewer presses Submit, the API:
1. Loads every row (serial + accessory) of the report inside one transaction.
2. Computes each row's effective status per §1.4 + §1.5.
3. If **any** row's effective status is `Pending` → 409 `report_has_pending_rows` with the count of pending rows. (Submit requires every row to have a non-Pending decision.)
4. If **any** row's effective status is `Rejected` → overall `Rejected`. Sets `status = 'Rejected'`, `completed_at = NOW()` (re-using the existing column for the terminal-decision timestamp; the column was already nullable per ASO/STU schema), writes one change-log row, and **performs no write-back**.
5. Otherwise overall `Approved`. Sets `status = 'Completed'`, `completed_at = NOW()`, **performs the write-back below**, writes one change-log row.

**Write-back targets when overall = Approved** (executed inside the same transaction as the status flip — atomic with the verdict):

A. **For every serial row in the report whose effective status is `Approved` AND `matched = true` AND `expected_serial_number IS NOT NULL`** (i.e., the auditor confirmed the expected unit at the audit location):
- Update the corresponding Master row (`payment_terminal_master` / `base_station_master` / `sim_card_master` keyed by `master_row_id`):
  - `present_location_id = session.location_id`
  - `present_location_since = NOW()` (only if `present_location_id` actually changed; otherwise leave the existing `present_location_since` untouched so the timeline isn't artificially refreshed by a routine reconfirmation audit).
  - `last_audited_at = NOW()` (always; this audit confirmed the row).
- For ASO reports the audit confirms **presence at the audit location**; the master's `state` is **not** changed. For STU reports the per-area audit also implies a state for the unit:
  - `working` area → master `state = 'Working'` (PT/BS) or `state = 'Active'` (SIM).
  - `under_repair` → `state = 'Under Repair'`.
  - `scrapped` → `state = 'Scrap'`.
  - `repaired_not_inspected` → `state = 'Repaired Not Inspected'`.
  - `retrieved_not_inspected` → `state = 'Retrieved Not Inspected'`.
  - This is the chief difference between an Approved ASO report (location reconciliation only) and an Approved STU report (location + state reconciliation).

B. **For every serial row whose effective status is `Approved` AND `matched = true` AND `unexpected_serial_number IS NOT NULL`** (the auditor scanned a serial that exists in a Master but wasn't expected here):
- Same Master writes as (A) — the unit's `present_location_id` moves to `session.location_id`, `last_audited_at = NOW()`, `present_location_since = NOW()`. (For STU, the same per-area state mapping in (A) also applies.)
- If the Master `state` was `Lost` at scan time (the auditor row carries `remarks` containing `Recovered`), the Approved write-back also sets `state = 'Working'` (PT/BS) or `state = 'Active'` (SIM) for an ASO report; STU reports use the per-area state from (A) instead.

C. **For every serial row whose effective status is `Approved` AND `missing = true`** (the auditor's expected row was *not* found and the reviewer agreed): set the master row's `state = 'Loss'` (PT/BS) or `state = 'Lost'` (SIM — `Lost` is the existing SIM enum value), `last_audited_at = NOW()`. Do NOT touch `present_location_id` — the unit's last-known location is preserved.

D. **For every accessory row whose effective status is `Approved`**: upsert into `accessory_stock_balances` keyed on `(vendor_sku_id, location_id = session.location_id)`:
- `working_quantity = row.working_count`
- `not_working_quantity = row.not_working_count`
- `last_audit_session_id = session.audit_session_id` (or `store_audit_session_id` for STU — see §3 for which column on the balance row receives this; both go into the existing `last_audit_session_id INTEGER REFERENCES audit_sessions(audit_session_id)` because the FK target is the ASO `audit_sessions` table. For STU-driven write-backs the FK has to relax to allow store-audit ids too — described in §3 / §10 as the one additional column-permission tweak on `accessory_stock_balances`).
- `last_updated_at = NOW()`.

For STU reports each accessory row carries a `storage_area_code`; the write-back rolls up across areas — `working_quantity = SUM(working_count) FOR area IN {'working','retrieved_not_inspected','under_repair','repaired_not_inspected'}` and `not_working_quantity = SUM(not_working_count)` over the same set. **The `scrapped` area is excluded** from the rollup — scrapped accessories don't count as live stock.

> NOTE: The spec doesn't enumerate accessory rollup across areas for STU. The reading above ("sum live areas, exclude Scrap") is the literal interpretation of the area's semantics. Override if product wants per-area accessory balances (would require extending `accessory_stock_balances` with `storage_area_code`).

**On Rejected**: no write-back runs. The report row simply transitions to `Rejected`. The auditor can start a new audit session at the same location (the `Rejected` row is terminal and does not block the partial unique index on `(auditor_user_id) WHERE status IN ('Incomplete','PendingReview')`).

**On the Cancel button (Incomplete reports)**: the existing ASO/STU `POST .../{id}/cancel` endpoint is **not** reused — the Reports cancel is performed by a reviewer (Admin or STU), not the auditor, and uses a distinct error path. A new `POST /audit-reports/{ain}/cancel` endpoint sets `status = 'Cancelled'`, `cancelled_at = NOW()`, `deleted_at = NOW()`, writes a `SoftDelete` change-log row, and emits no write-back. See §6.

### 1.7 Authorization summary

| Endpoint                                                          | SA       | Admin    | STU                          | ASO  | Other operational |
|-------------------------------------------------------------------|----------|----------|------------------------------|------|-------------------|
| `GET /audit-reports` (list)                                       | **200**  | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `GET /audit-reports/{ain}` (read)                                 | **200**  | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `POST /audit-reports/{ain}/cancel` (Incomplete only)              | 403      | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `PATCH /audit-reports/{ain}/serial-rows/{row_id}`                 | 403      | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `PATCH /audit-reports/{ain}/accessory-rows/{row_id}`              | 403      | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `POST /audit-reports/{ain}/submit`                                | 403      | **200**  | **200** (ASO-authored only)  | 403  | 403               |
| `GET /audit-reports/{ain}/download` (Approved only)               | **200**  | **200**  | **200** (ASO-authored only)  | 403  | 403               |

- `(ASO-authored only)` rows return **404** — not 403 — when an STU asks for a STU-authored AIN, so the STU does not learn that another report exists. Cross-type access by STU is filtered at the list level and gated at the detail level.
- SA's read access includes the full payload (every row, every reviewer remark, the computed overall status), but every write endpoint returns 403 for SA.

### 1.8 Change log integration
- Per Phase 1 §10 minimal change-log model: every state-changing report action writes exactly **one** row to `change_log`. Action enum reused without extension:
  - `POST /audit-reports/{ain}/cancel` (reviewer cancel of Incomplete) → `(AuditSession|StoreAuditSession, AIN, reviewer, SoftDelete)`.
  - `PATCH /audit-reports/{ain}/serial-rows/{row_id}` (set / clear reviewer_status) → `(AuditSerialRow|StoreAuditSerialRow, row_id, reviewer, Update)`.
  - `PATCH /audit-reports/{ain}/accessory-rows/{row_id}` → `(AuditAccessoryRow|StoreAuditAccessoryRow, row_id, reviewer, Update)`.
  - `POST /audit-reports/{ain}/submit` (status transition to `Completed` or `Rejected`) → **one** `(AuditSession|StoreAuditSession, AIN, reviewer, Update)` row. The per-row PATCHes already emitted their own rows during the review phase; Submit emits only the session-level transition row.
  - **Write-back side effects** (Approved only): each Master row updated emits one `(PaymentTerminalMaster|BaseStationMaster|SIMCardMaster, <serial>, reviewer, Update)` row; each accessory balance upsert emits one `(AccessoryStockBalance, <vendor_sku_id>:<location_id>, reviewer, Create|Update)` row. The per-target rows are written **inside the same transaction** as the session's Submit transition.
- `change_log.object_type` is free-form `TEXT`; the new values used by this slice (`PaymentTerminalMaster`, `BaseStationMaster`, `SIMCardMaster`, `AccessoryStockBalance`) need **no** migration to be accepted.
- A PATCH that submits the same reviewer_status currently stored (no-op) does **not** write a change-log row, matching Phase 1 §10's invariant.

### 1.9 Resolved product decisions
- `Completed` in the DB renders as `Approved` in the UI; no rename. `Rejected` is added as a new permitted value via one ALTER on each status CHECK (the one DDL change).
- Auto-approve rules are computed at read time and are never persisted. Only the reviewer's explicit decision (and remarks) is stored.
- A reviewer can flip a row's `reviewer_status` back and forth any number of times before Submit; each flip writes one change-log row.
- The Submit transition is **all-or-nothing**: if any row is still effectively `Pending`, Submit returns 409 without writing anything. The reviewer must clear every pending row first.
- Cancelled reports (cancelled either by the auditor at audit time or by a reviewer from this screen) are soft-deleted and **excluded** from the Reports listing. They remain in `change_log` for forensics.
- Pagination at 25 rows per table per page is applied to the Admin and STU views uniformly — the spec mentions it only for Admin but the cost of including it in STU's view is zero and the UX is consistent.

---

## 2. Reports listing

The top-level Reports screen lists every non-Cancelled PAR the caller is permitted to see.

### Fields per row (as returned by the list endpoint)
- `audit_index` (the AIN string, e.g., `AIN-10123`).
- `report_type` (enum: `aso` | `stu`) — disambiguates which underlying table the row came from; drives icon / colour in the UI list.
- `auditor_user_id`, `auditor_user_index`, `auditor_first_name`, `auditor_last_name`.
- `auditor_role` (enum: `ASO` | `STU`).
- `location_id`, `location_name` (snapshot from the session's `location_snapshot_name`).
- `created_at` (the session's `started_at` — when the audit was first started, used as "Date/Time of report creation").
- `status` (UI label per §1.3 — one of `Pending`, `Incomplete`, `Approved`, `Rejected`).

### API endpoint
- `GET /audit-reports` — list. Filters:
  - `status` (comma-separated, accepts UI labels): `Pending`, `Incomplete`, `Approved`, `Rejected`. Cancelled reports are excluded unconditionally.
  - `report_type`: `aso` | `stu` | `both` (default: caller's permission; STU sees `aso` only and a `report_type=stu` filter for STU returns 422 `forbidden_filter`).
  - `auditor_user_id`, `location_id`, `started_at_from` / `_to`.
  - `page` (default 1) and `page_size` (default 25, max 100) for pagination.
- Response shape: `{ items: [...], page, page_size, total }`. Sorted by `created_at DESC` (most recent first) by default; the UI offers AIN ascending as an alternative sort.

### Validation rules
- All filter values are typecast-validated; invalid values return 422 `bad_format`.
- An STU asking for `report_type=stu` returns 422 (the type is filtered at the auth layer; the explicit filter is treated as malformed).

### Business rules / invariants
- Cancelled reports never appear in the listing. They are reachable only via `change_log` queries (out of scope for this slice).
- Sort is stable across paginations — ties on `created_at` break by `audit_session_id` to keep page boundaries deterministic.

### UI surface
- See §9.1 — the Audit Reports landing screen.

### Acceptance
- An Admin's `GET /audit-reports` returns ASO and STU reports interleaved in `created_at DESC` order.
- An STU's `GET /audit-reports` returns only ASO reports; STU reports authored by the same or another STU do not appear.
- `?status=Approved,Rejected&page=2` returns the second page (rows 26–50) of just the terminal-decision reports.
- A Cancelled report is absent from every listing, regardless of who calls.

---

## 3. Report detail — common fields

A single endpoint serves all read-detail use cases, regardless of which lifecycle state the report is in (Incomplete / Pending / Approved / Rejected). The UI decides which actions to surface based on the returned `status`.

### Endpoint
- `GET /audit-reports/{ain}` — read one with full row expansion. `{ain}` is the `audit_index` string (e.g., `AIN-10123`). The backend disambiguates ASO vs STU by looking the AIN up in both `audit_sessions` and `store_audit_sessions` (separate counters, so an AIN exists in at most one table).

### Response shape
```
{
  audit_index, report_type ('aso'|'stu'),
  auditor: { user_id, user_index, first_name, last_name, role },
  location: { location_id, location_name, vendor_id, vendor_name },
  created_at, completed_at, cancelled_at,
  status,                                  -- UI label per §1.3
  summary: {                               -- present only when caller is Admin AND status is Pending or Rejected
    serial: { approved: <int>, pending: <int> },
    accessory: { approved: <int>, pending: <int> }
  },
  table1: {                                -- serial rows
    state: 'Editing'|'Submitted',          -- the auditor's table state (frozen by Submit; unchanged by Reports)
    rows: [ {...serial_row, effective_status, reviewer_status, reviewer_remarks, reviewed_at, reviewed_by_user_id }, ... ]
  },
  table2: { state, rows: [...] },           -- accessory rows; STU reports add storage_area_code to each row
  areas: ['working','retrieved_not_inspected','under_repair','scrapped','repaired_not_inspected'],  -- only present for STU reports
  is_reviewable: true|false,                -- convenience flag; true iff status is Pending or Rejected and caller has reviewer scope
  is_cancellable: true|false,               -- true iff status is Incomplete and caller has reviewer scope
  is_downloadable: true|false               -- true iff status is Approved
}
```

### Per-row payload
Each row carries every persisted field (from the existing ASO/STU row table) **plus** the four reviewer columns from §1.5 **plus** the computed `effective_status` per §1.4 / §1.5. The UI uses `effective_status` to colour the row and to decide whether to auto-move-to-bottom (§6.3).

### Cross-references
- Serial-row fields: see `task3-aso.md` §3 (ASO) and `task3-stu.md` §4 (STU; includes `storage_area_code`).
- Accessory-row fields: see `task3-aso.md` §4 (ASO) and `task3-stu.md` §5 (STU; includes `storage_area_code`).

### The `accessory_stock_balances.last_audit_session_id` FK widening
- The ASO slice declared `last_audit_session_id INTEGER REFERENCES audit_sessions(audit_session_id)`. STU-driven Approved write-backs need to record the *store_audit_session_id* instead. To support both without breaking the existing FK:
  - Drop the FK constraint on `accessory_stock_balances.last_audit_session_id` and replace with a plain `INTEGER` plus a sibling column `last_audit_session_type TEXT CHECK (last_audit_session_type IN ('aso','stu'))`. The pair encodes which table the ID belongs to.
  - Idempotent migration in `017_phase3_report.sql`: `ALTER TABLE accessory_stock_balances DROP CONSTRAINT IF EXISTS accessory_stock_balances_last_audit_session_id_fkey; ALTER TABLE accessory_stock_balances ADD COLUMN IF NOT EXISTS last_audit_session_type TEXT CHECK (last_audit_session_type IN ('aso','stu'));`
  - Existing rows (all written by ASO slice — none yet because Approved didn't exist) get `last_audit_session_type = NULL`. The Report slice fills it on every write. Reads UNION the two tables when joining for display.
- Documented as the **second** (and last) DDL change Phase 3 Report introduces against an existing table. Both DDL changes are strictly value-permitting / FK-loosening — no existing row becomes invalid.

---

## 4. Report detail — read-only state (`Approved`, `Rejected`, `Cancelled`)

When the report's status is one of the terminal states:
- No action buttons visible (except the Download button — see §8 — for `Approved`).
- The reviewer columns and `effective_status` are still returned per row, but the UI renders them read-only (no inline edit affordance).
- Reviewer info: the response includes for each non-auto-approved row the `reviewed_by_user_id` so the UI can render "Reviewed by <First Last> at <time>" badges.

### Acceptance
- `GET /audit-reports/{ain}` for an `Approved` report returns `is_reviewable: false`, `is_downloadable: true`, and every row's `effective_status` is one of `Approved` / `Rejected` (never `Pending`, since Submit succeeded).
- A PATCH against any row of a terminal-status report returns 409 `report_frozen` and writes nothing.
- A `POST .../cancel` against a terminal-status report returns 409 `report_not_incomplete`.

---

## 5. Report detail — `Incomplete` (reviewer cancel path)

Per spec §3.3.1 / §3.3.2: when a report is `Incomplete` (the auditor has not yet pressed Complete), the reviewer's only action is **Cancel**.

### Endpoint
- `POST /audit-reports/{ain}/cancel` — reviewer-side cancel of an Incomplete report. Confirmation modal in the UI. Allowed only when the underlying session status is `Incomplete`. SA returns 403; Admin always allowed; STU allowed only for ASO reports.
- On success: sets `status = 'Cancelled'`, `cancelled_at = NOW()`, `deleted_at = NOW()` on the underlying session row; writes one `(AuditSession|StoreAuditSession, AIN, reviewer, SoftDelete)` change-log row. The session disappears from the Reports listing immediately.
- The auditor's own `POST .../audit-sessions/{id}/cancel` endpoint (Phase 3 ASO §2, STU §2) is **unchanged** — it remains the path the original auditor uses to cancel their own in-progress audit. Either party can cancel; both paths lead to the same `Cancelled` terminal state.

### Validation rules
- 409 `report_not_incomplete` if the session's current status is anything other than `Incomplete`.
- 410 `report_already_cancelled` if a concurrent cancel raced and the soft-delete already ran (the response includes the AIN so the UI can refresh its list).

### Business rules / invariants
- Reviewer-driven cancel is **distinct** from auditor-driven cancel in the change log only by the actor — the action enum (`SoftDelete`) is identical. A downstream forensics query distinguishes the two by joining `change_log.actor_user_id` against `users.user_type_code`.
- Cancelling an `Incomplete` report mid-edit kills the auditor's in-progress work irreversibly. There is no undo. The auditor's next `POST .../audit-sessions` (or `.../store-audit-sessions`) succeeds and creates a fresh session at a new AIN (the partial-unique-index no longer blocks because the cancelled row is `deleted_at` and not non-terminal).

### Acceptance
- An STU presses Cancel on an ASO's Incomplete report → 200, status flips to `Cancelled`, the ASO's next visit to `/audit` lands in the `{ status: 'none' }` state.
- An Admin presses Cancel on an STU's Incomplete report → 200; same outcome on the STU side.
- An STU presses Cancel on a STU's Incomplete report → 404 (the report wasn't visible in the first place — STU sees only ASO reports).
- An SA presses Cancel on any Incomplete report → 403.

---

## 6. Report detail — `Pending` / `Rejected` (review path)

This is the spec's primary workflow: the reviewer opens a report whose status is `Pending` (or `Rejected` — a `Rejected` report is re-reviewable, see below), reviews each row, and presses Submit.

### 6.1 Per-row review — `PATCH /audit-reports/{ain}/serial-rows/{row_id}` and `…/accessory-rows/{row_id}`

Request body for serial rows: `{ "reviewer_status": "Approved" | "Rejected" | null, "reviewer_remarks"?: string | null }`. Same shape for accessory rows.

- Both fields are independently nullable: the reviewer can clear a status without clearing remarks (rare) or vice-versa.
- `reviewer_status = null` un-sets the row's decision; the row falls back to its auto-computed status (per §1.4).
- `reviewer_remarks` sanitization: trimmed, max 500 chars, newlines replaced with single space.
- Allowed only when the report's status is `Pending` or `Rejected`. Otherwise 409 `report_frozen`.
- Writes `reviewed_at = NOW()` and `reviewed_by_user_id = caller` on every PATCH that changes either column (a no-op PATCH writes nothing — see §1.8).
- Writes one change-log row per non-no-op PATCH (per §1.8).
- The row's effective status flips immediately in subsequent reads; the UI updates the row's badge and re-sorts (auto-Approved + Approved rows sink to the bottom — §9.3).

### 6.2 Submit — `POST /audit-reports/{ain}/submit`

- Allowed only when the report's status is `Pending` or `Rejected`. (Yes, `Rejected` — see §6.5 for re-review semantics.) Otherwise 409 `report_frozen`.
- The endpoint runs the §1.6 algorithm in a single transaction.
- Returns the updated report payload (same shape as `GET /audit-reports/{ain}`) with the new `status` (`Approved` or `Rejected`).
- Idempotent against the **same** Submit call → if the response was lost and the client retries, the second call sees the already-terminal status and returns 409 `report_frozen` with the cached status. Clients should `GET` to fetch the canonical state.

### 6.3 Auto-move-to-bottom (UI behaviour, server-side support)

- The list of rows returned by `GET /audit-reports/{ain}` is sorted server-side: `effective_status = 'Pending'` first (in original seed order), then `effective_status = 'Rejected'` (chronological by `reviewed_at`), then `effective_status = 'Approved'` (chronological by `reviewed_at`, with auto-approved rows treated as `reviewed_at = NULL` and sorted last). This matches the spec's "rows move to the bottom" wording without requiring the UI to maintain an animation state machine.
- The UI re-fetches (or applies the same sort locally) after each PATCH so the row's position updates without a full reload.

### 6.4 Overall status preview (UI computation)

- The UI computes a "current verdict" indicator from the same rule §1.6 step 4–5 uses: if any row is `Rejected` → preview `Rejected`; else if every row is non-`Pending` → preview `Approved`; else preview `Pending`. This is purely a UI affordance; the server never persists a preview.
- The preview is shown next to the Submit button so the reviewer sees what pressing Submit will commit.

### 6.5 Re-reviewing a `Rejected` report

- A `Rejected` report can be re-opened for review. The reviewer can flip rows from `Rejected → Approved`, clear `reviewer_status` to re-trigger auto-approve, etc. Pressing Submit again recomputes the overall status: a previously-`Rejected` report can become `Approved` (and trigger the write-back) or stay `Rejected`.
- This is supported because the spec doesn't say `Rejected` is irreversible, and the side-effect-on-Approved invariant still holds (write-back is gated on the overall status at Submit time, not on the prior status).
- An `Approved` report is **not** re-reviewable — its write-back already ran and reversing the Master-table changes is out of scope.

### Acceptance
- An Admin reviewing a `Pending` ASO report PATCHes one auto-`Approved` serial row's `reviewer_status` to `Rejected` with `reviewer_remarks: "duplicate inventory"`; the row's effective status flips to `Rejected`, the preview verdict flips to `Rejected`, and Submit returns 200 with overall `Rejected` and no Master write-backs.
- An STU PATCHes every row of an ASO's `Pending` report to `Approved`, presses Submit → 200, overall `Approved`, every matched serial row's Master `present_location_id` is now `session.location_id` and `last_audited_at` is now NOW.
- An Admin presses Submit on a report with one row still `Pending` → 409 `report_has_pending_rows` with the count.
- An Admin re-Submits a previously `Rejected` report with every row now `Approved` → 200, overall flips to `Approved`, write-backs run.

---

## 7. Per-row reviewer columns — schema reference

The four columns added to each of `audit_session_serial_rows`, `audit_session_accessory_rows`, `store_audit_serial_rows`, `store_audit_accessory_rows`:

```sql
ALTER TABLE audit_session_serial_rows
  ADD COLUMN IF NOT EXISTS reviewer_status      TEXT
    CHECK (reviewer_status IS NULL OR reviewer_status IN ('Approved','Rejected')),
  ADD COLUMN IF NOT EXISTS reviewer_remarks     TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id  INTEGER REFERENCES users(user_id);
-- (repeat for the other three row tables)
```

- All four are nullable; existing rows keep NULL.
- No new index — the report rollup loads every row of one session at a time (small N) and never filters by these columns in isolation.
- The cross-row guarantee "either both `reviewed_at` and `reviewed_by_user_id` are set or both are NULL" is enforced by the API layer (PATCH always writes both together), not by a DB check — consistent with how `task3-aso.md` and `task3-stu.md` keep their row constraints to category checks only.

---

## 8. PDF download

- `GET /audit-reports/{ain}/download` — returns `application/pdf` with `Content-Disposition: attachment; filename="<AIN>.pdf"`. Only for `Approved` reports; other statuses return 409 `report_not_approved`.
- The PDF embeds the same data the `GET /audit-reports/{ain}` JSON response carries: header block (AIN, auditor, role, location, created/completed timestamps, final status), Table 1 (every serial row with auditor remarks + reviewer remarks + reviewer status), Table 2 (every accessory row, similarly), and — for STU reports — the per-area breakdown.
- Generated server-side using the existing PDF helper (mirrors the Phase 2 attempt-summary PDF if one exists; otherwise a lightweight `pdfkit` integration in a new `lib/pdf/auditReport.js`). The PDF is rendered on demand, not cached on disk — re-downloading regenerates from the same DB rows. Approved reports are immutable, so re-renders are byte-stable.
- The Download button is visible for `Approved` reports to every role with read access (SA, Admin, and STU for ASO reports).

### Acceptance
- `GET /audit-reports/AIN-10123/download` for an Approved report returns a non-empty `application/pdf` whose first page header reads `Audit Report — AIN-10123`.
- The same endpoint against a `Pending` / `Rejected` / `Cancelled` report returns 409 `report_not_approved`.

---

## 9. UI surface — Audit Reports screen

### 9.1 Listing page (`/audit-reports`)
- **New top-level nav entry**: `Audit Reports`. Rendered when `user.user_type_code` is `ADMIN`, `SA`, or `STU`. ASO and other operational types do not see it.
- Path: `/audit-reports`. Single route.
- On mount, calls `GET /audit-reports` with default filters.
- Filter chips at the top: Status (multi-select), Type (`ASO` / `STU` / `Both`; the Type chip is hidden for STU since the type is always ASO), Auditor (typeahead by name / `user_index`), Location (typeahead), Date range.
- Table columns per spec §3.3: PAR AIN Index, User (auditor full name + `user_index`), Role, Location, Created At, Status (rendered as a coloured pill — `Pending` amber, `Incomplete` grey, `Approved` green, `Rejected` red).
- AIN cell is a hyperlink to `/audit-reports/{ain}`.
- Pagination control at the bottom (Prev / page numbers / Next), 25 rows per page.

### 9.2 Detail page (`/audit-reports/{ain}`)
- Three sub-states based on the response's `status` + the action flags `is_reviewable`, `is_cancellable`, `is_downloadable`:
  - **Read-only** (`Approved` / `Rejected` / `Cancelled`): header block + Download button (Approved only) + read-only tables. See §4.
  - **Incomplete**: header block + Cancel button (with confirmation modal — see below). No tables; no row review. See §5.
  - **Reviewable** (`Pending` or `Rejected` for callers with reviewer scope): header block + Submit button + (Admin only) Summary block + tables with per-row Reviewer Remarks + Reviewer Status columns appended. See §6.
- Header block fields (always shown): PAR AIN, Auditor name + role + email, Location name + vendor, Created At, Status pill.
- **Cancel button** opens `<ConfirmModal>` (the existing Phase 1 component): `Cancel this audit and abandon the auditor's in-progress work? This cannot be undone.` Buttons: `Keep open` / `Cancel audit`.
- **Submit button** opens `<ConfirmModal>`: `Submit this review? The report will become <Approved|Rejected> based on your row decisions. <Approved variant: This will write the audit's findings back to the Master tables and cannot be undone.>` Buttons: `Cancel` / `Submit`.

### 9.3 Per-row review UI
- Each row in Table 1 / Table 2 gets two additional cells at the right edge: `Reviewer Remarks` (single-line input, 500 char max), `Status` (a small two-button toggle: `Approve` / `Reject`; clicking sets `reviewer_status`; a tiny `↺` icon clears the decision and lets the row fall back to auto-status).
- Rows render with a background tint matching their `effective_status` (Pending = no tint; Approved = light green; Rejected = light red).
- On `effective_status = Approved` flip, the row animates into the bottom-of-table group (the server already returns rows in the sort order described in §6.3; the UI just re-renders the new order). Animation is a 200ms slide; respects `prefers-reduced-motion`.

### 9.4 Admin-only Summary block (Pending / Rejected reports)
- Renders only when caller is `ADMIN` and the report is `Pending` or `Rejected`. (STU's review of ASO reports does not show the block, per spec.)
- Two stacked cards:
  - **Serial Type SKUs** — `Approved: <n>   Pending: <n>` where the two counts come from the response's `summary.serial` object.
  - **Accessory Type SKUs** — same shape from `summary.accessory`.
- Counts update reactively as the reviewer PATCHes row statuses.

### 9.5 Responsive & accessibility
- Page conforms to Phase 1 §1.3 breakpoints. Below 640px the per-row review controls collapse into a row-detail drawer (tap a row → drawer slides up with the two review controls).
- The Approve / Reject toggle buttons have a tap target ≥ 44 × 44px on touch.
- The Status pill colour is paired with a text label and an icon so colour is never the sole signal.
- All toggle / Cancel / Submit actions have keyboard equivalents (Tab → Space).

### 9.6 API parity
- Every operation (list, read, cancel, row PATCH, Submit, download) is reachable via REST under `/audit-reports/...`. A script can review and Submit a report end-to-end without ever rendering the page.

---

## 10. Validation Rules (consolidated)

### 10.1 Error code → HTTP → user-facing message

| Code                              | HTTP | Message template                                                                                                                              |
|-----------------------------------|------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `report_not_found`                | 404  | `Audit report <AIN> not found.` Used when caller doesn't have visibility (e.g., STU asking for a STU-authored AIN).                            |
| `report_frozen`                   | 409  | `This report has been finalized and cannot be modified.` Returned by row-PATCH or Submit against a `Cancelled` / `Approved` / `Incomplete` report. |
| `report_not_incomplete`           | 409  | `Only Incomplete reports can be cancelled from this screen.` Returned by the reviewer-side `cancel` endpoint against any non-Incomplete report. |
| `report_already_cancelled`        | 410  | `This report has already been cancelled.`                                                                                                     |
| `report_has_pending_rows`         | 409  | `Submit requires every row to have a decision. <n> row(s) are still pending review.`                                                          |
| `report_not_approved`             | 409  | `Only Approved reports can be downloaded.`                                                                                                    |
| `reviewer_status_invalid`         | 422  | `reviewer_status must be 'Approved', 'Rejected', or null.`                                                                                    |
| `reviewer_remarks_too_long`       | 422  | `reviewer_remarks may be at most 500 characters.`                                                                                             |
| `forbidden_filter`                | 422  | `The '<field>' filter value '<value>' is not permitted for your role.` (STU asking for `report_type=stu`.)                                    |
| `report_pdf_unavailable`          | 503  | `Could not generate the PDF for <AIN>. Try again in a moment.` Returned only on the rare PDF-renderer failure; never on a missing report.     |

Error envelope shape matches Phase 1/2 convention: `{ error: <human message>, code: <machine code>, fields?: { … } }`.

### 10.2 Transaction boundaries
- Every mutating endpoint runs inside one transaction. The row-PATCH transaction contains the column write + the change-log insert.
- The Submit transaction contains: read all rows → status decision → (if Approved) Master write-backs + `accessory_stock_balances` upserts + change-log rows per write-back target → session status flip + the one session-level change-log row. Failure at any step rolls back the whole transaction.
- The reviewer-side Cancel transaction contains the session soft-delete + the one change-log row.

### 10.3 Concurrency
- Two reviewers PATCHing the same row simultaneously: the database serializes the writes; both PATCHes succeed (last write wins on the `reviewer_status`/`reviewer_remarks` columns and on `reviewed_at`/`reviewed_by_user_id`). The change log preserves both edits.
- Reviewer A presses Submit while reviewer B is PATCHing rows: the Submit transaction takes a row-level advisory lock keyed on `audit_session_id` (or `store_audit_session_id`); B's concurrent PATCH waits, then sees the session is frozen and returns 409 `report_frozen`.
- Reviewer-side Cancel races with the auditor's own Cancel: the partial unique-violation guard handles it — second writer sees the row already soft-deleted and returns 410 `report_already_cancelled`.

### 10.4 Idempotency
- `GET /audit-reports` and `GET /audit-reports/{ain}` are naturally idempotent.
- `PATCH .../serial-rows/{row_id}` / `…/accessory-rows/{row_id}` are idempotent against no-op submissions (same value, no write, no change-log row).
- `POST /audit-reports/{ain}/cancel` is **not** idempotent — re-posting on an already-cancelled report returns 410.
- `POST /audit-reports/{ain}/submit` is **not** idempotent — re-posting on an already-terminal report returns 409. Clients re-GET to learn the canonical state.

---

## 11. Change-log integration (cross-cutting recap)

Per Phase 1 §10's minimal model, this slice writes exactly one `change_log` row per state change. Master and accessory-balance write-backs each emit one row per touched row, all inside the Submit transaction:

| Trigger                                                  | object_type                                            | object_id                          | action       |
|----------------------------------------------------------|--------------------------------------------------------|------------------------------------|--------------|
| `POST /audit-reports/{ain}/cancel` (reviewer-side cancel) | `AuditSession` or `StoreAuditSession`                 | `<AIN>`                            | `SoftDelete` |
| `PATCH /audit-reports/{ain}/serial-rows/{row_id}`        | `AuditSerialRow` or `StoreAuditSerialRow`              | `<row_id>`                         | `Update`     |
| `PATCH /audit-reports/{ain}/accessory-rows/{row_id}`     | `AuditAccessoryRow` or `StoreAuditAccessoryRow`        | `<row_id>`                         | `Update`     |
| `POST /audit-reports/{ain}/submit` (status transition)   | `AuditSession` or `StoreAuditSession`                  | `<AIN>`                            | `Update`     |
| Submit, write-back per matched serial row (Approved only) | `PaymentTerminalMaster` / `BaseStationMaster` / `SIMCardMaster` | `<serial_number>`               | `Update`     |
| Submit, write-back per accessory row (Approved only)     | `AccessoryStockBalance`                                | `<vendor_sku_id>:<location_id>`    | `Create` or `Update` |

- The four new `object_type` values introduced by this slice (`PaymentTerminalMaster`, `BaseStationMaster`, `SIMCardMaster`, `AccessoryStockBalance`) require no migration — `change_log.object_type` is free-form `TEXT`.
- No per-field diff (consistent with Phase 1 §10). The volume of write-back rows on a large Approved report can be high; the bulk insert is batched in groups of 500 to keep the transaction's row-count manageable without sacrificing atomicity.

---

## 12. Files to add (suggested layout — does not edit any existing file except the three thin integration points)

### Backend
- `code/backend/src/migrations/017_phase3_report.sql`
  - Four `ADD COLUMN IF NOT EXISTS` blocks (one per row table) for the reviewer columns.
  - Two `ALTER TABLE … DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT` blocks for the widened status CHECK on `audit_sessions` and `store_audit_sessions` (to permit `Rejected`).
  - One `ALTER TABLE accessory_stock_balances DROP CONSTRAINT IF EXISTS … ; ADD COLUMN IF NOT EXISTS last_audit_session_type TEXT CHECK (…)` for the FK widening described in §3.
  - All idempotent.
- `code/backend/src/routes/auditReports.js` — list, read, cancel, row-PATCH (×2), submit, download endpoints (§§2–8). Internally dispatches to ASO or STU table based on AIN-range lookup.
- `code/backend/src/lib/pdf/auditReport.js` — PDF renderer (§8). Pure function from a report payload to a `Buffer`.
- **Edits to existing files (the three thin integration points):**
  - `code/backend/src/lib/auth.js` — append `requireReportReader` and `requireReportReviewer` middlewares next to the existing role helpers. No existing export is modified.
  - `code/backend/src/server.js` — mount the new `auditReports` router. One line.
  - `code/backend/src/lib/ids.js` — unchanged (no new counter; AINs are issued by ASO and STU slices).

### Frontend
- `code/frontend/src/pages/AuditReports.jsx` — the listing page (§9.1).
- `code/frontend/src/pages/AuditReportDetail.jsx` — the detail page with the three sub-states (§9.2 – §9.4).
- **Edits to existing files:**
  - `code/frontend/src/lib/api.js` — append the new API client helpers (`listAuditReports`, `getAuditReport`, `cancelAuditReport`, `patchSerialRowReview`, `patchAccessoryRowReview`, `submitAuditReport`, `downloadAuditReport`) next to the existing ASO/STU helpers. No existing helper is modified.
  - `code/frontend/src/components/Layout.jsx` — add the `Audit Reports` nav entry, rendered when `user.user_type_code` is `ADMIN`, `SA`, or `STU`. One conditional `<NavLink>`.
  - `code/frontend/src/main.jsx` — add the `/audit-reports` and `/audit-reports/:ain` routes. Two `<Route>` entries.

### Tests
- `code/backend/test/auditReports.test.js` — covers every acceptance criterion in §2, §4, §5, §6, §8.
- `code/backend/test/auditReports.writeback.test.js` — covers the §1.6 write-back algorithm end-to-end against seeded ASO and STU sessions, including the negative-side-effect invariant on `Rejected`.
- `code/frontend/src/pages/AuditReports.test.jsx`, `AuditReportDetail.test.jsx` — covers §9 render states, the Admin-only summary block, the row auto-sort, and the confirm modals for Cancel / Submit.

---

## 13. Open product questions (defaults chosen; override at any point)

1. **STU per-area accessory rollup** — chose `working` + `retrieved_not_inspected` + `under_repair` + `repaired_not_inspected` summed into `working_quantity` / `not_working_quantity`, `scrapped` excluded. Override if product wants per-area accessory balances (would require extending `accessory_stock_balances` with `storage_area_code`).
2. **STU per-area Master state mapping** — chose `working → Working`, `under_repair → Under Repair`, `scrapped → Scrap`, `repaired_not_inspected → Repaired Not Inspected`, `retrieved_not_inspected → Retrieved Not Inspected`. Override if any area should map to a different `state`.
3. **Approved write-back for `missing = true` rows** — chose `state = 'Loss'` (PT/BS) / `state = 'Lost'` (SIM), preserving `present_location_id`. Override if Missing-and-Approved should fully clear `present_location_id`, or do nothing (treat as a no-op).
4. **Approved write-back for Unregistered rows** — chose **no write-back** (Unregistered serials don't exist in any Master to write into). Override if product wants the Approve of an Unregistered row to *insert* a new Master row (would need an Innoviti / Vendor SKU choice from the reviewer).
5. **`Rejected` re-review semantics** — chose to allow re-review (the reviewer can flip rows and re-Submit to flip the overall verdict). Override if `Rejected` should be terminal-and-irrevocable; reverting to terminal would also remove the `is_reviewable: true` flag on `Rejected` reports.
6. **PDF caching** — chose on-demand regeneration (no on-disk cache). Override to cache the rendered Buffer keyed on `(ain, completed_at)` for cheap repeat downloads.
7. **`Rejected` overall-status auditor notification** — chose **no notification** (the auditor learns the verdict by visiting `/audit` and seeing their report is now Rejected). Override to add an email / in-app notification flow.
8. **Reviewer remarks character limit** — chose 500. Override to align with the auditor's `remarks` cap (also 500 in the ASO slice) or to allow longer reviewer notes.
9. **Admin-only Summary block on STU's review of ASO reports** — chose not to render it for STU (per spec — the Summary block is enumerated only in §3.3.2 Admin). Override if STU should also see the summary.
10. **`last_audit_session_id` FK widening** — chose to drop the FK on `accessory_stock_balances.last_audit_session_id` and add a `last_audit_session_type` discriminator. Override to keep two columns instead — `last_aso_audit_session_id` + `last_store_audit_session_id`, each with its own FK — and leave the original `last_audit_session_id` for back-compat.

---

## 14. Out of scope for this slice

- **Editing or deleting an Approved report's write-back** — once `Completed`, the Master and accessory-balance changes stand. Reversing them is not in scope. The next audit at the same location naturally overwrites them.
- **Reviewer-to-auditor messaging** — if a reviewer Rejects a report and wants to explain why, the only channel is the per-row `reviewer_remarks`. There is no separate comment thread, no email, no in-app notification.
- **Bulk-Approve / Bulk-Reject across reports** — every Submit is per-report. Multi-report workflows are a future-phase concern.
- **Restoring a Cancelled report** — `Cancelled` is terminal and soft-deleted. There is no un-cancel.
- **Editing the auditor's original `remarks` field** — the reviewer cannot modify what the auditor wrote; they only append `reviewer_remarks`. The two columns are independent.
- **Per-area accessory balances on `accessory_stock_balances`** — the table continues to be one row per `(vendor_sku_id, location_id)`. Per-area breakdowns are a future-phase concern (see §13 question 1).
- **PDF customization** — the PDF layout is fixed; no template editor, no logo upload (the Innoviti logo seeded in Phase 1 is the only branding shown).
- **Reviewer-side dispute / appeal flow** — once Approved, there's no formal "I changed my mind" path. The reviewer can mentally re-open the audit by starting a fresh audit at the location and Approving it.
- **Cross-report analytics / dashboards** — total Approved / Rejected over time, by reviewer, by location, etc. — out of scope; lives in the future MIS Reporting module.
- **Activation of ALU / RLU / FNU / LOU on reports** — out of scope; these user types remain dormant through the Report slice.
