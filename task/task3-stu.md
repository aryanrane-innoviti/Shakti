# Shakti Supply Chain Management System — Implementation Tasks (Phase 3, STU slice)

## How to read this document

This document is the build-ready task breakdown for the **Store User (STU) audit-session journey** that ships in Phase 3 of Shakti. It covers exactly what `docs/Audit_Store_User.docx` specifies: how a Store User starts, runs, suspends, completes, or cancels an Audit Session that walks them through **five storage-area tabs** (Working, Retrieved Not Inspected, Under Repair, Scrapped, Repaired Not Inspected), each with its own Table 1 (serial-type SKUs) and Table 2 (accessory SKUs).

It deliberately **excludes**:
- The ASO audit-session journey (`docs/Audit_Aso_User.docx` → `task/task3-aso.md`, already shipped).
- The Admin review screens that approve / reject a Store User's PendingReview audit (`docs/Audit_Report.docx` → separate task file).
- The Store-user review of an ASO's PendingReview audit (separate task file).
- Any non-audit Phase 3 work.

**Hard constraints inherited from prior phases and the ASO slice:**
- Phase 3 STU must be built **without changing any Phase 1, Phase 2, or Phase 3 ASO requirement, table, route, or screen**. The STU slice is **additive**: new tables, new endpoints, new screens, a new nav entry that only STU users see.
- The only Phase 1 / Phase 2 / Phase 3-ASO surface area this slice touches **at all** is:
  - The `change_log.object_type` column, **appended** to (never reordered or removed) with three new values (`StoreAuditSession`, `StoreAuditSerialRow`, `StoreAuditAccessoryRow`). The column has been free-form `TEXT` since 014, so no DDL change is required for the enum — only string conventions. (`UserStoreLocation` from earlier drafts is not introduced; location changes ride on the existing `User` row that `POST` / `PATCH /users` already emits — see §1.7.)
  - The three Master tables' `present_location_id`, `present_location_since`, `last_audited_at` columns — these were created NULL-at-load **specifically so the Audit flow could populate them**. STU writes values into existing columns at the **Admin-review approve** step; **the STU slice in this file only stages those values inside the PAR**. The actual write-back to the masters lands in the Admin-review task file.
  - `accessory_stock_balances` (created by the ASO slice in migration 014) is **read** at seed time by STU's Table 2. Writes happen at Admin approve, again in a separate task file.
- **API-first**: every audit operation — starting a session, picking an area tab, submitting scans, updating counters, submitting/modifying a table, completing/cancelling, resuming — is a REST endpoint. The UI in §7 is a thin client over those endpoints.
- All Phase 1 Foundations (auth, soft-delete, change log, API parity, branding, responsive design, backup) carry forward unchanged.
- The ASO routes (`/audit-sessions/*`), tables (`audit_sessions`, `audit_session_serial_rows`, `audit_session_accessory_rows`), and middleware (`requireAso`) are **read-only references** for this slice. No edit, no rename, no reuse-by-extension. STU gets its own parallel object graph (§2–§6). The single shared piece of state across the two slices is `users.location_id` (Phase 1) — both slices consume it, neither slice owns it.

If a STU requirement appears to need an in-place change to a Phase 1, Phase 2, or ASO-slice file, halt and surface the conflict to product before implementing.

Out-of-scope items are listed in the footer. Ambiguities are marked inline with `> NOTE:` when a reasonable default was chosen; resolved product decisions are recorded in §1.10.

---

## 1. Foundations (Phase 3 / STU)

### 1.1 Additive-only rule (re-statement for STU)
- No Phase 1, Phase 2, or Phase 3-ASO source file is edited as part of this slice. New things introduced:
  - New tables (`store_audit_sessions`, `store_audit_serial_rows`, `store_audit_accessory_rows`).
  - New routes under `/store-audit-sessions/...`. **No new endpoint** is introduced for assigning a STU's store location — assignment rides on the User Create / Modify endpoints (`POST` / `PATCH /users`, `task1.md` §3), with one Phase 3-additive guard hook (see §5.1).
  - **Zero DDL changes** to any existing table. The `users.location_id` column the STU slice depends on is already part of the Phase 1 schema (`task1.md` §3) — the STU slice simply consumes it. Earlier drafts proposed a parallel `user_store_locations` join table; that is now explicitly **dropped** in favor of reusing the same `users.location_id` that the ASO slice consumes (one column per user; the user's `user_type_code` discriminates which Audit module reads it).
  - A new top-level **Store Audit** nav entry and screen that renders **only** for users whose `user_type_code = 'STU'`.
  - A new `requireStu()` middleware in `code/backend/src/lib/auth.js`, added **next to** the existing `requireAso` helper without modifying any existing export.
- STU may **read** every Phase 1, Phase 2, and ASO-slice table (Users, Vendors, Locations, SKUs, Vendor SKUs, the three Master tables, `accessory_stock_balances`) but must not alter their schemas.
- The two exceptions to "read-only against prior phases":
  1. `change_log.object_type` gains three new string values (`StoreAuditSession`, `StoreAuditSerialRow`, `StoreAuditAccessoryRow`). No DDL change — the column is already free-form `TEXT`.
  2. The three Master tables' `present_location_id`, `present_location_since`, `last_audited_at` and `accessory_stock_balances`'s `working_quantity` / `not_working_quantity` are **written** when an Admin later approves a `PendingReview` Store-audit. For this slice, those writes happen in the Admin-review task file; the STU slice only stages the values inside the PAR.

### 1.2 STU user type activation
- The `STU` (Store User) user type was seeded in Phase 1 §2 (`code: 'STU'`, `label: 'Store User'`, mutable) but had **no permissions** anywhere in Phase 1, Phase 2, or the Phase 3 ASO slice. This file activates STU **only** for the Store-Audit endpoints (§5) and the Store-Audit screen (§7). STU still has **no** access to any Section 1 or Section 2 object, and no access to ASO audit endpoints.
- The activation is purely route-level: a new `requireStu()` middleware returns 403 unless `req.session.user_type_code === 'STU'`.
- SA and ADMIN keep their existing Phase 1 / Phase 2 / ASO-slice access unchanged. They additionally gain **read-only** access to store-audit sessions for oversight (see §1.9).
- ASO retains its existing Phase 3-ASO access and gains **nothing** here — it cannot read, list, or mutate any Store-Audit session.
- All other operational user types (ALU, RLU, FNU, LOU) remain dormant.

### 1.3 STU Store Location (on the existing users table)
- An STU **cannot start a Store-Audit Session** unless `users.location_id` is populated for that user. The session-start endpoint enforces this — there is no separate "Locked Store Location" object, table, or join.
- The location lives directly on the user row, on the `users.location_id` column already in the Phase 1 schema (`task1.md` §3). It is the same column the ASO slice consumes; the discriminator is `users.user_type_code` — an ASO user's `location_id` is read by `/audit-sessions/*`, an STU user's `location_id` is read by `/store-audit-sessions/*`. A given user is one type or the other, never both, so the column has exactly one semantic owner per row.
- The location validation for an STU (the `location_eligible` type check plus the location-vendor-matches-user-vendor rule) is **enforced** by the User write endpoints (`POST` / `PATCH /users`, `task1.md` §3 validation rules). Phase 3 does not duplicate those checks. (An STU defaults to the Innoviti vendor, so its store location is an Innoviti location by vendor-match — no hardcoded Innoviti gate.)
- The location of an STU can be changed by an SA or Admin **only when there is no `Incomplete` or `PendingReview` Store-Audit session for that STU**. This guard is the **one new piece of behavior** Phase 3 adds to the User write endpoints — see §5.1. It cannot live in Phase 1 because the `store_audit_sessions` table doesn't exist until Phase 3.
- No Locations-side assignment endpoint exists any more — `POST` / `PATCH /users` (`task1.md` §3) is the sole writer of `users.location_id` for STU users. Phase 3 attaches one additive guard hook.

> NOTE: The source spec is silent on **where** the Store User's location comes from. The wording "the store user has 4 storage areas within his location" implies a pre-bound single location, but does not say which schema field carries it. The chosen mechanism (Phase 1 `users.location_id` populated on the User Create / Modify form, `task1.md` §3) mirrors exactly the ASO mechanism so the two slices stay symmetric and product / operators only have to learn one assignment workflow. Override only if STU's location must logically live on a separate field from ASO's — there is no architectural reason for that today.

### 1.4 Store-Audit Session lifecycle
There are exactly four lifecycle states, recorded in `store_audit_sessions.status`:

| Status          | Meaning                                                                                                       | Visible to STU? | Editable? |
|-----------------|---------------------------------------------------------------------------------------------------------------|-----------------|-----------|
| `Incomplete`    | Session exists; user has not yet pressed Complete or Cancel. Tabs may be partially filled.                    | Yes — resumable | Yes       |
| `PendingReview` | User pressed Complete. PAR is frozen; awaiting **Admin** review (separate task file closes the loop).         | Yes — read-only | No        |
| `Cancelled`     | User pressed Cancel. PAR is **not retained for reporting** (see §6.7). Row is soft-deleted; kept for forensics. | No              | No        |
| `Completed`     | Admin approved (closes the loop). **Set in the Admin-review task file** — this STU slice never writes this. Listed for enum completeness. | Read-only | No |

**One non-terminal session per user (mutual exclusion):**
- A given STU `user_id` may have at most **one** row whose `status ∈ {Incomplete, PendingReview}` at any time. Enforced by a partial unique index `(user_id) WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL` so that race conditions in `POST /store-audit-sessions` cannot create two.
- Attempting to start a session while a `PendingReview` exists returns the **exact source-spec error string** from `docs/Audit_Store_User.docx`: `Previous audit <AIN> is awaiting Admin review. Cannot start a new audit by the same user until the previous audit review is closed.` (HTTP 409, code `store_audit_pending_review_block`).
- Attempting to start a session while an `Incomplete` exists silently resumes it (returns the existing session — no new row). Matches the spec's "the session Provisional Audit Report (PAR) is shown and the user can continue their audit."

### 1.5 30-minute inactivity rule
- Every write to a session bumps `store_audit_sessions.last_activity_at` to `NOW()`.
- A scheduler job runs every **5 minutes** (same cadence and pattern as the ASO-slice `runAuditSuspensionJob`; new export `runStoreAuditSuspensionJob`, wired from `server.js` alongside it). It does nothing destructive to `Incomplete` sessions:
  - Snapshots `auto_suspended_at = NOW()` on any `Incomplete` row whose `last_activity_at < NOW() - INTERVAL '30 minutes'` and whose `auto_suspended_at IS NULL`.
  - When the STU reopens the session (any write), `auto_suspended_at` is cleared.
- Because every scan and counter increment is persisted server-side immediately (§5), the user genuinely "loses nothing" on inactivity — the session simply becomes auto-suspended. Reopening the Store-Audit tab continues from the same state.
- The status stays `Incomplete`; `auto_suspended_at` is the only signal that the user idled out. This matches the interpretation chosen in the ASO slice (§1.5 of task3-aso.md) — the spec wording is identical here, and we apply the same reading so STU and ASO behave consistently.

> NOTE: The spec wording "the audit session PAR is automatically submitted and its status under Reports will show as Incomplete" is ambiguous between "auto-submit moves to a new status" and "auto-submit is a UX rule." The ASO slice chose the second reading and this slice follows it. Override only if product wants the two slices to behave differently (which would be surprising for the user).

### 1.6 Audit Index (AIN) — separate counter from ASO
- Each Store-Audit Session gets an immutable `audit_index` of format `AIN-NNNNN`, generated via `lib/ids.js::nextIndex('store_audit')` — a **new** counter kind in the existing `counters` table. No schema change — `counters` already accepts arbitrary names.
- The STU and ASO AIN sequences are intentionally **separate**: ASO `AIN-NNNNN` starts from `AIN-10001` (existing `'audit'` counter), STU `AIN-NNNNN` starts from `AIN-50001` (new `'store_audit'` counter). Different start values keep the visible AIN unambiguously sortable by slice in Reports.

> NOTE: The spec only says "AIN-10001, 5 digit auto incremented number starting with 10001." It does not say STU shares the ASO counter. Using a different start (50001) for STU avoids ambiguity in Reports where both ASO and STU audits appear side-by-side. Override if product wants a single global AIN sequence — that's also a one-line change in `lib/ids.js`.

### 1.7 Change log integration
- Per Phase 1 §10's minimal change-log model: every state-changing Store-Audit action writes exactly **one** row to `change_log`. Action enum reused without extension:
  - Session create → `(StoreAuditSession, AIN-NNNNN, STU actor, Create)`.
  - Table-1 scan submission, Table-1 row Working/Not-Working toggle, Table-2 counter change → `(StoreAuditSerialRow|StoreAuditAccessoryRow, row_id, STU actor, Create|Update)`.
  - Per-area Table-1/Table-2 Submit and Modify (toggles between editable and frozen) → `(StoreAuditSession, AIN, actor, Update)`.
  - Complete → `(StoreAuditSession, AIN, actor, Update)` (status transition).
  - Cancel → `(StoreAuditSession, AIN, actor, SoftDelete)`.
  - Mutations of `users.location_id` ride on the existing per-user `User` change-log row that `POST` / `PATCH /users` (Phase 1, `task1.md` §3) already emits. No new `object_type` value, no extra row from this slice.
- All writes happen **inside the same transaction** as the originating mutation (Phase 1 §10 invariant). A failed change-log insert rolls back the audit mutation.
- `change_log.object_type` gains three new string values used by this slice: `StoreAuditSession`, `StoreAuditSerialRow`, `StoreAuditAccessoryRow`. Column is `TEXT`; no migration required, only a code convention. (`UserStoreLocation` from earlier drafts is dropped — the location change rides on the existing `User` row.)

### 1.8 Storage areas (the five tabs)
The Store User's session is divided into **five fixed storage areas**, each rendered as a tab below the "Complete Audit Session <AIN>" header. Each area corresponds 1-to-1 with a value of the Master tables' `state` column:

| Area code (internal)       | UI label                  | Master `state` filter       | Table 2 counter column label |
|----------------------------|---------------------------|------------------------------|------------------------------|
| `working`                  | Working                   | `Working`                    | `Working Count`              |
| `retrieved_not_inspected`  | Retrieved Not Inspected   | `Retrieved Not Inspected`    | `Retrieved Not Inspected Count` |
| `under_repair`             | Under Repair              | `Under Repair`               | `Under Repair Count`         |
| `scrapped`                 | Scrapped                  | `Scrap`                      | `Scrap Count`                |
| `repaired_not_inspected`   | Repaired Not Inspected    | `Repaired Not Inspected`     | `Repaired Not Inspected Count` |

- The set of areas is **closed and configured in code** (a const array in `code/backend/src/routes/storeAuditSessions.js` plus a matching `STORAGE_AREAS` export in the frontend). It is not a database table — there are exactly five, and a new area is a code change with a migration if needed (see §1.10).
- Each area has its own independent Table 1 and Table 2 inside the same session. Submit / Modify state for each table is **per-area** (a session carries 5 × 2 = 10 independent Editing/Submitted flags).
- The duplicate-scan guard (§5.4) is scoped to the **session + area** pair — the same serial can legitimately appear in two different areas if (improbably) the masters disagree, but the spec's "the same audit session" wording is interpreted as "within the same area of the same session" because each area is a logically separate sub-audit. Override if product wants cross-area duplicate-scan blocking.

> NOTE 1: The spec body details only four areas (3.2.1–3.2.8 cover Working, Retrieved Not Inspected, Under Repair, Repaired Not Inspected). The list of tabs at the top of §3.2 includes a fifth, **Scrapped**, with no dedicated sub-section. We include Scrapped as a fifth area following the same pattern as the other four, mapped to Master state `Scrap` (per the existing convention seen in the ASO-slice `EXPECTED_PT_BS_STATES` exclusion list). Override if Scrapped should be excluded entirely or treated differently.
>
> NOTE 2: SIM Card Master's `state` column uses different values (`Active`, `Inactive`, `Blocked`, `Lost`). The 5-tab model is shaped around PT/BS lifecycle. For SIMs in each tab we apply a state mapping: `working` ↔ `Active`; `retrieved_not_inspected` / `under_repair` / `repaired_not_inspected` / `scrapped` ↔ none (SIM seeds are empty for those four tabs). Override if a different SIM-to-tab mapping is wanted (the spec is silent — it lists SIM Cards as a serial-type SKU in each table header but never says which SIM states map to which tab).

### 1.9 Authorization summary for Phase 3 (STU slice)

| Endpoint                                                                  | SA      | Admin   | STU                    | ASO   | Other operational |
|---------------------------------------------------------------------------|---------|---------|------------------------|-------|-------------------|
| `POST` / `PATCH /users` (Phase 1, `task1.md` §3 — listed for completeness; the STU is the row whose `location_id` is being mutated) | **200** | **200** | n/a | n/a | n/a |
| `POST /store-audit-sessions`                                              | 403     | 403     | **201/200**            | 403   | 403               |
| `GET /store-audit-sessions/current`                                       | 403     | 403     | **200**                | 403   | 403               |
| `GET /store-audit-sessions/{id}`                                          | **200** | **200** | **200** (own only)     | 403   | 403               |
| `GET /store-audit-sessions` (list, filters)                               | **200** | **200** | 403                    | 403   | 403               |
| `POST /store-audit-sessions/{id}/areas/{area}/table1/scan`                | 403     | 403     | **200** (own)          | 403   | 403               |
| `PATCH /store-audit-sessions/{id}/areas/{area}/table1/rows/{row_id}`      | 403     | 403     | **200** (own)          | 403   | 403               |
| `POST /store-audit-sessions/{id}/areas/{area}/table1/submit` / `…/modify` | 403     | 403     | **200** (own)          | 403   | 403               |
| `PATCH /store-audit-sessions/{id}/areas/{area}/table2/rows/{row_id}`      | 403     | 403     | **200** (own)          | 403   | 403               |
| `POST /store-audit-sessions/{id}/areas/{area}/table2/submit` / `…/modify` | 403     | 403     | **200** (own)          | 403   | 403               |
| `POST /store-audit-sessions/{id}/complete`                                | 403     | 403     | **200** (own)          | 403   | 403               |
| `POST /store-audit-sessions/{id}/cancel`                                  | 403     | 403     | **200** (own)          | 403   | 403               |

- **SA + Admin** can **read all Store-audit sessions and assign Locked Store Locations**, but cannot start, run, complete, or cancel a session on someone else's behalf. There is no "audit on behalf of user X" route in this slice.
- **STU** can mutate **only their own session**. The `(own only)` rows return 403 — not 404 — if the path refers to another user's session, so STU does not even learn that another session exists. Same posture the ASO slice uses for its sessions.
- **ASO** is explicitly cut from all Store-audit endpoints. The two roles do not bleed.

### 1.10 Resolved product decisions
- The STU's store location is the Phase 1 `users.location_id` column (`task1.md` §3) — the same column the ASO slice consumes. No parallel join table is introduced; `users.user_type_code` is the discriminator that decides which Audit module reads the value.
- `STU` user type is activated route-by-route — no global "STU can read everything" door.
- The 30-minute inactivity rule freezes editing UX but does not change session status. Auto-suspended sessions remain `Incomplete` and resumable. Matches the ASO slice.
- Cancelled PARs are **soft-deleted** (`deleted_at = NOW()`) so the AIN sequence and audit trail are preserved; they do **not** render in any Reports list (consistent with the spec line "It is not visible in Audit Reports also").
- Accessory expected quantity (Table 2) is sourced from the existing `accessory_stock_balances` table created in the ASO slice (migration 014). When no row exists for a `(vendor_sku_id, location_id)` pair, `expected_quantity = 0` (rendered as "0" per the spec line "If the Expected Item Qty is zero, the same is shown"). STU **does not** mutate that table — the Admin-approve path does.
- A new AIN counter (`'store_audit'` starting at `50001`) is allocated so STU and ASO AINs are visibly distinct. Override to a single shared counter if product prefers.
- Five storage areas including Scrapped. Override if Scrapped should be dropped (spec is silent on its details).
- SIM Cards seed only into the `working` area's Table 1 (mapped to SIM state `Active`). Override the mapping if a different SIM-to-area assignment is needed.

---

## 2. Store-Audit Session

The Store-Audit Session is the top-level Phase 3 STU object owned by an STU user. One session = one PAR = one audit visit to the STU's Locked Store Location, broken into five storage-area tabs.

### Fields & types
- `store_audit_session_id` (auto, internal).
- `audit_index` (string, format `AIN-NNNNN` starting at `AIN-50001`, monotonic, immutable). Generated via `lib/ids.js::nextIndex('store_audit')`.
- `auditor_user_id` (FK → `users`, **required**, **immutable** after creation). Must be an STU user.
- `auditor_user_index` (string, denormalized snapshot of `users.user_index` at session start — preserved across actor renames / soft deletes; matches the change-log denormalization pattern).
- `location_id` (FK → `locations`, **required**, **immutable** after creation). Resolved from `users.location_id` (Phase 1, `task1.md` §3) at session start; **snapshotted** so a later location reassignment via `PATCH /users/{id}` does not retroactively change historical PARs.
- `location_snapshot_name` (string, snapshot of `locations.location_name` at session start).
- `status` (enum, **required**, default `Incomplete`): one of `Incomplete`, `PendingReview`, `Cancelled`, `Completed`. This file writes only the first three; `Completed` is reserved for the Admin-review task file.
- **Per-area state columns** — five `*_table1_state` and five `*_table2_state` columns, each enum `Editing`|`Submitted`, default `Editing`. The naming follows the `area_code` from §1.8:
  - `working_table1_state`, `working_table2_state`
  - `retrieved_not_inspected_table1_state`, `retrieved_not_inspected_table2_state`
  - `under_repair_table1_state`, `under_repair_table2_state`
  - `scrapped_table1_state`, `scrapped_table2_state`
  - `repaired_not_inspected_table1_state`, `repaired_not_inspected_table2_state`
  > NOTE: Ten columns on a single row keeps every state transition cheap (one UPDATE, no join). The alternative — a separate `store_audit_session_areas` table — adds a join for every page load with no behavioral benefit, because the set of areas is fixed.
- `started_at` (timestamp, default `NOW()` on insert).
- `last_activity_at` (timestamp, bumped on every write).
- `auto_suspended_at` (timestamp, nullable; set by the 5-minute job when `last_activity_at < NOW() - 30m`; cleared on the next write).
- `completed_at` (timestamp, nullable; set when status moves to `PendingReview`).
- `cancelled_at` (timestamp, nullable; set when status moves to `Cancelled`).
- `created_at`, `updated_at`, `deleted_at` (timestamps; `deleted_at` is set only on cancel — soft delete is the only retirement mechanism).

### Index / uniqueness
- Partial unique index `(auditor_user_id) WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL` — enforces the one-non-terminal-session-per-user invariant at the DB level.
- Unique index on `audit_index`.
- Index on `(status, started_at DESC)` for admin oversight list queries.
- Partial index on `(last_activity_at) WHERE status = 'Incomplete' AND auto_suspended_at IS NULL AND deleted_at IS NULL` — used by the auto-suspension job.

### API endpoints
- `POST /store-audit-sessions` — start a session for the calling STU. Body is empty. Server resolves the auditor's Locked Store Location, allocates the AIN, snapshots the location name, seeds all five areas of Table 1 (§3) and Table 2 (§4), writes the Create change-log row, and returns the full session payload. **STU only.**
  - If the auditor's `users.location_id IS NULL` → HTTP 422 `store_location_not_assigned`.
  - If the auditor already has an `Incomplete` session → returns that existing session (HTTP 200), not a new one.
  - If the auditor has a `PendingReview` session → HTTP 409 with the exact spec error string and `store_audit_pending_review_block`.
- `GET /store-audit-sessions/current` — convenience for the Store-Audit tab landing page. Returns the calling STU's current `Incomplete` session (with all five areas expanded), or `{ status: 'PendingReview', audit_index: 'AIN-…' }` if a PendingReview exists, or `{ status: 'none' }` otherwise. **STU only.**
- `GET /store-audit-sessions/{id}` — read one with all five areas expanded. SA/Admin can read any; STU can read only their own (cross-user access returns 403, not 404).
- `GET /store-audit-sessions` — list with filters `status`, `auditor_user_id`, `location_id`, `started_at_from`/`_to`. SA/Admin only.
- `POST /store-audit-sessions/{id}/complete` — transition to `PendingReview`. Requires **all ten** per-area table states (`working_table1_state`, `working_table2_state`, …) to be `Submitted`. Otherwise HTTP 409 `store_audit_tables_not_submitted` with the offending `(area, table)` pairs named in `fields.pending`. **STU only, own session.**
- `POST /store-audit-sessions/{id}/cancel` — transition to `Cancelled` + soft-delete. Idempotent (already-cancelled returns 200 + the row). **STU only, own session.**

### Validation rules
- A session cannot be created without a Locked Store Location.
- A session cannot transition `Incomplete → PendingReview` unless **all ten** per-area `*_state` columns are `Submitted`.
- A session in `PendingReview` rejects all mutations (scan, row patch, submit, modify, complete) with HTTP 409 `store_audit_session_frozen`. Only the (future) Admin-review path can move it on.
- A session in `Cancelled` rejects all mutations with HTTP 410 `store_audit_session_cancelled`.
- The STU's Locked Store Location may be reassigned **only when no `Incomplete` or `PendingReview` session exists** for that user (§1.3).

### Business rules / invariants
- A session **snapshots** its location at start time. Reassigning the STU's Locked Store Location does not retroactively move the session.
- The PAR identity is the session row itself. There is no separate `pars` table — Table 1 and Table 2 row tables (§3, §4) are children of the session and discriminated by `storage_area_code`.
- The Reports view (defined in a separate task file) filters by `status IN ('Incomplete','PendingReview','Completed') AND deleted_at IS NULL` — Cancelled sessions are excluded.

### UI surface
See §7 for the full screen. The session header shows:
- AIN, location name (snapshot), STU name, started-at.
- The button `Complete Audit Session <AIN>` (top of page).
- The button `Cancel Audit Session <AIN>` (next to Complete).
- A small inline notice when `auto_suspended_at IS NOT NULL`: `Auto-suspended at <time> — your session is ready to resume.`
- Below the Complete/Cancel row, the five area tabs (Working | Retrieved Not Inspected | Under Repair | Scrapped | Repaired Not Inspected).

### Cross-object dependencies
- `users.location_id` must be populated for the auditor (assigned via `POST` / `PATCH /users` — Phase 1 §3).
- `locations` row must exist (Phase 1 §9) and belong to the Innoviti vendor.

### Acceptance
- An STU with no Locked Store Location gets HTTP 422 on `POST /store-audit-sessions`.
- An STU with a Locked Store Location and no prior non-terminal session: `POST /store-audit-sessions` returns 201 with a fresh AIN, all five areas seeded into both tables, status `Incomplete`, every `*_state` = `Editing`.
- Re-`POST /store-audit-sessions` with the same STU returns the same existing session (no duplicate AIN, no extra row, no second change-log Create).
- An STU with a `PendingReview` session: `POST /store-audit-sessions` returns 409 with the exact spec message including the prior AIN and the **Admin** review wording (not Store review).
- `POST /store-audit-sessions/{id}/complete` while any one of the ten `*_state` columns is `Editing` returns 409 naming the offending `(area, table)` pair(s).
- `POST /store-audit-sessions/{id}/cancel` flips status to `Cancelled`, sets `deleted_at`, writes a `SoftDelete` change-log row; subsequent reads via `GET /store-audit-sessions/{id}` succeed but no scan/submit/modify mutation does.
- Two concurrent `POST /store-audit-sessions` calls for the same STU produce exactly one new session (the partial unique index prevents the second insert; the second call falls back to the resume path).

---

## 3. Store-Audit Session — Table 1 (Serial-type rows, per area)

Table 1 holds one row per serial-numbered unit that is either expected at the audit location **for the selected area's state**, scanned during the audit at that area, or scanned-but-unknown at that area.

### Fields & types
- `store_audit_serial_row_id` (auto, internal).
- `store_audit_session_id` (FK → `store_audit_sessions`, **required**, **immutable**).
- `storage_area_code` (enum, **required**, **immutable**): one of `working`, `retrieved_not_inspected`, `under_repair`, `scrapped`, `repaired_not_inspected`.
- `master_kind` (enum, **required**): `payment_terminal`, `base_station`, `sim_card`, or NULL for an Unregistered row that hit no Master.
- `master_row_id` (BIGINT, **nullable**). Populated when `master_kind` is set; NULL for Unregistered.
- `vendor_sku_id_snapshot` (FK → `vendor_skus`, **nullable**). SIM Card Master now carries `vendor_sku_id` natively (Phase 2 §3, parity rework), so this snapshot can be populated for SIM rows too — but the SIM loader currently leaves the master column NULL, so today SIM rows still snapshot NULL here and fall back to `sku_id_snapshot` / `sku_number_snapshot` for display. Unregistered rows are always NULL.
- `vendor_sku_number_snapshot`, `vendor_sku_name_snapshot` (strings, snapshots).
- `sku_id_snapshot` (FK → `skus`, **nullable**; populated for all kinds when resolvable, null for Unregistered).
- `sku_number_snapshot`, `sku_name_snapshot` (strings, snapshots).
- `expected_serial_number` (string, **nullable**) — non-null only for **pre-populated expected rows** (units the Master table says are at this location in this area's state).
- `unexpected_serial_number` (string, **nullable**) — non-null when an in-Master serial was scanned that wasn't on the expected list of this area.
- `unregistered_serial_number` (string, **nullable**) — non-null when a scanned serial doesn't exist in any Master.
- `matched` (boolean, default `false`) — true once the expected row is hit by a scan, OR once an Unexpected/Unregistered row is created (those count as matched at creation time).
- `missing` (boolean, default `false`) — set to true on the **per-area** Table-1 Submit when `expected_serial_number IS NOT NULL AND matched = false`. Cleared back to false on the per-area Modify.
- `remarks` (string, optional) — free-text plus reserved phrases. Reserved phrases auto-inserted at scan time:
  - `Wrong Location` — set on an Unexpected row whose Master `present_location_id` was not null and was not the session's `location_id` at scan time.
  - `Recovered` — appended (after `Wrong Location` if both apply, comma-separated) when the Master row's `state` was `Lost` at scan time.
  - > NOTE: The Store-User spec wording does not add a "Wrong Area" remark when an in-Master row was at the right location but in a different `state` than the current tab. We interpret this gap as: such a row becomes an Unexpected row in the current tab without a special remark — the existing reserved phrases were not designed for cross-area drift. Override if product wants a third reserved phrase `Wrong Area` for this case.
- `working_status` (enum, **required**, default `Working`): `Working` or `Not Working`. Default applies to **both** pre-populated and scanned rows. This per-row toggle still exists in the Store-User spec even though the area tabs already encode the state — it lets the auditor disagree with the Master.
- `scanned_at` (timestamp, nullable; set when a row gets matched-by-scan or created-by-scan).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Index / uniqueness
- Index on `(store_audit_session_id, storage_area_code)`.
- Index on `(store_audit_session_id, storage_area_code, expected_serial_number)` for the duplicate-scan check.
- Index on `(store_audit_session_id, storage_area_code, unexpected_serial_number)`.
- Index on `(store_audit_session_id, storage_area_code, unregistered_serial_number)`.
- **No global unique index** on serial — different sessions / areas can legitimately scan the same serial.
- A check constraint enforces **exactly one** of (`expected_serial_number`, `unexpected_serial_number`, `unregistered_serial_number`) is non-null.

### Pre-population at session start (per area)
On `POST /store-audit-sessions`, the server seeds Table 1 with one row per expected unit, **per area**:

- **Source predicate per area** (PT and BS): every non-deleted Master row where:
  - `present_location_id = session.location_id`, AND
  - `state = <Master state value for this area>` (per the mapping in §1.8), AND
  - the joined `vendor_skus.status = 'Active'` and `vendor_skus.deleted_at IS NULL`.
- **SIM Cards**: seeded only into the `working` area, with predicate `state = 'Active'` and the joined Innoviti `skus.status = 'Active'`. The other four areas seed zero SIM rows (§1.8 NOTE 2). SIM Card Master now carries `vendor_sku_id` (Phase 2 §3, parity rework), but the SIM loader does not yet populate it; while that's the case the activeness gate falls back to the joined Innoviti `skus.status = 'Active'`. Once SIM loads start populating `vendor_sku_id`, the gate should switch to `vendor_skus.status = 'Active'` to match PT/BS. Override the mapping if product wants SIM Cards visible in additional tabs.
- Row population per area: each seeded row carries `storage_area_code = <area>`, `expected_serial_number = master.serial_number_or_sim_card_number`, `matched = false`, `missing = false`, `working_status = 'Working'`, all `_snapshot` fields filled from the master + the joined `vendor_sku` (or `sku` for SIM).
- All seeding happens **inside the session-creation transaction**. Seeding failure rolls back the session.
- Seeding cost is bounded by Phase 1 §1.6's 30 concurrent users SLA — for the largest realistic location (≤ 5 000 units across all states) the seed is five batched INSERTs (one per area).

### Scan handling — `POST /store-audit-sessions/{id}/areas/{area}/table1/scan`

Path parameter `area` must be one of the five area codes; otherwise 404.

Request body: `{ "serial_number": "<scanned value>", "vendor_sku_id": <id> | "sku_id": <id> }`. Exactly one of `vendor_sku_id` (for PT/BS) or `sku_id` (for SIM Innoviti SKU) is required — same scoping requirement the ASO slice uses (see `code/backend/src/routes/auditSessions.js` `resolveScanTarget`). Without scoping, two units with the same serial under different Vendor SKUs would race.

Server-side algorithm (single transaction):

1. **Permission gate**: 403 if caller is not the session owner.
2. **State gate**: 409 `store_audit_session_frozen` if `status != 'Incomplete'`; 409 `store_table1_frozen` if the per-area `<area>_table1_state = 'Submitted'`.
3. **Trim + normalize**: collapse whitespace, reject blank → 422 `required_missing`.
4. **Scan-target resolution**: as for ASO (`resolveScanTarget`-equivalent, copied into `code/backend/src/routes/storeAuditSessions.js` rather than imported — keeping the ASO file untouched). Reject malformed payload with 422 `scan_target_required` / `scan_target_invalid` / `bad_format`.
5. **Duplicate guard**: SELECT in Table 1 WHERE session_id matches AND `storage_area_code = $area` AND `<scope_column> = $scope` AND ((expected = trimmed AND matched=true) OR unexpected = trimmed OR unregistered = trimmed). If any row matches → 409 `duplicate_scan` with the exact spec message: `<S.No.> has already been audited in this session.`.
   > NOTE: The spec says "the same audit session"; we scope to `(session, area, scoped vendor SKU / SIM SKU)` to be consistent with the ASO slice's scoping and to allow the same serial to legitimately exist across areas (e.g., if it's pre-seeded in Working and also somehow lives in Under Repair). Override only if you want a strictly session-wide block.
6. **Expected match path**: find an unmatched expected row in this area with matching serial and scope. If found → UPDATE that row to `matched = true`, `scanned_at = NOW()`. Return 200 with the updated row.
7. **Master search path** (Unexpected): search PT Master → BS Master → SIM Card Master, scoped to the picked Vendor SKU (PT/BS) or Innoviti SIM SKU. On a hit:
   - INSERT a new Table-1 row with `storage_area_code = $area`, `master_kind` = matched master, `master_row_id` = its PK, `unexpected_serial_number = trimmed`, `matched = true`, `scanned_at = NOW()`, snapshots filled from the master + joined vendor SKU / SKU.
   - Reserved remarks:
     - if `master.present_location_id IS NOT NULL` AND `master.present_location_id != session.location_id` → append `Wrong Location`.
     - if `master.state = 'Lost'` → append `Recovered`.
   - Return 200.
8. **Unregistered path**: if no Master match, INSERT a new Table-1 row with `storage_area_code = $area`, `master_kind = NULL`, `master_row_id = NULL`, all snapshots null except the picked target's snapshot, `unregistered_serial_number = trimmed`, `matched = true`, `scanned_at = NOW()`. Return 200.
9. **Always**: bump `store_audit_sessions.last_activity_at = NOW()`, clear `auto_suspended_at` if set; write one change-log row `(StoreAuditSerialRow, row_id, actor, Create|Update)`.

### Scan-target listing — `GET /store-audit-sessions/{id}/areas/{area}/table1/scan-targets`
- Returns `{ vendor_skus: [...], sim_skus: [...] }` with the same shape as the ASO slice's `/audit-sessions/{id}/table1/scan-targets`. Used by the UI's scan-target picker (§7.3). The area path parameter does not affect the list (the targets are global to the session), but is included for URL consistency and future per-area filtering.

### Row update — `PATCH /store-audit-sessions/{id}/areas/{area}/table1/rows/{row_id}`

Whitelisted updatable fields: `working_status` (`Working`|`Not Working`), `remarks` (free text appended after the reserved-phrase prefix; the reserved phrases themselves are not editable).

- `working_status` toggle is allowed at any time while the per-area `<area>_table1_state = 'Editing'`. While `Submitted`, returns 409 `store_table1_frozen`.
- `remarks` edits are sanitized: leading whitespace stripped; max 500 chars; newlines replaced with spaces (matches ASO slice rule).
- The path's `{area}` must equal the row's `storage_area_code`; otherwise 404. Prevents accidentally patching a row from the wrong tab.
- Bumps `last_activity_at`; writes change-log row `(StoreAuditSerialRow, row_id, actor, Update)`. No-op PATCH (no field changes) writes nothing (Phase 1 §10 invariant).

### Per-area Table-1 Submit / Modify

- `POST /store-audit-sessions/{id}/areas/{area}/table1/submit` — transition the per-area state `<area>_table1_state: Editing → Submitted`. Computes the Missing flags **scoped to this area**: `UPDATE store_audit_serial_rows SET missing = true WHERE store_audit_session_id = $1 AND storage_area_code = $2 AND expected_serial_number IS NOT NULL AND matched = false`. Disables the scan window in this tab. Writes one change-log row `(StoreAuditSession, AIN, actor, Update)`.
- `POST /store-audit-sessions/{id}/areas/{area}/table1/modify` — transition the per-area state `<area>_table1_state: Submitted → Editing`. Clears Missing flags **scoped to this area** back to false. Re-enables the scan window in this tab. Writes one change-log row.
- Submit/Modify in one area does **not** affect the other four areas' state.

### Validation rules
- Scan serial must be 1–100 chars after trimming (matches Master `serial_number` column constraints).
- `working_status` outside `{Working, Not Working}` returns 422 `bad_format`.
- `remarks` is optional; null is a valid value.
- Path `{area}` outside the closed set of five returns 404.

### Business rules / invariants
- A row's category is **exactly one** of expected / unexpected / unregistered — DB check constraint.
- `master_row_id` may be null only when `unregistered_serial_number IS NOT NULL`.
- Soft delete is **not used** for individual Table-1 rows. A row is either present (correct) or absent. Mistaken scans cannot be retracted via DELETE — the per-area Modify button is the rollback mechanism.
- Row `storage_area_code` is immutable post-insert; rows cannot be moved between tabs.

### UI surface
See §7.3 — the per-area Table-1 panel inside the Store-Audit screen.

### Acceptance
- Session creation at a location with 12 PT units `Working`, 4 BS units `Working`, 8 PT units `Under Repair`, 25 SIM cards `Active` (whose vendor SKU / SIM SKU is Active) seeds **45 rows total**: 16 (PT + BS) in `working`, 8 in `under_repair`, 25 SIMs in `working`, 0 in other areas. Every row has `matched=false`, `missing=false`, `working_status='Working'`.
- Scanning a serial that matches an expected row in the **current** tab → that row flips to `matched=true`; no new row.
- Scanning a serial that matches an expected row in a **different** tab → not matched here; new Unexpected row in the **current** tab is created (because the spec's match is per-area, per the tab the user is on).
- Scanning a serial that is in PT Master at a different location → new Unexpected row, `remarks = 'Wrong Location'`.
- Scanning a serial whose Master state is `Lost` → new Unexpected row, `remarks = 'Recovered'` (or `Wrong Location, Recovered` if both apply).
- Scanning a serial nowhere in any Master → new Unregistered row.
- Scanning the same serial twice in the same area: second scan returns 409 with the exact spec message including the serial.
- After per-area Submit, every expected row in that area with `matched=false` has `missing=true`; rows in other areas are untouched. After per-area Modify, `missing` flags in that area only are cleared.
- Patching `working_status` to `Not Working` succeeds while the area's `*_state = Editing`, returns 409 while `Submitted`.

---

## 4. Store-Audit Session — Table 2 (Accessory rows, per area)

Table 2 holds one row per (area, **active accessory Vendor SKU**) the location should track, with counters the STU increments.

### Fields & types
- `store_audit_accessory_row_id` (auto, internal).
- `store_audit_session_id` (FK → `store_audit_sessions`, **required**, **immutable**).
- `storage_area_code` (enum, **required**, **immutable**): same five values as §3.
- `vendor_sku_id` (FK → `vendor_skus`, **required**, **immutable**).
- `vendor_sku_number_snapshot`, `vendor_sku_name_snapshot` (strings, snapshots).
- `expected_quantity` (integer ≥0, **required**, **snapshot from `accessory_stock_balances` at seed time, only for the `working` area**; 0 for all other areas — see seed rules below). May be 0.
- `counted_count` (integer ≥0, default 0) — the area-specific count the spec calls "Working Count" / "Retrieved Not Inspected Count" / etc. The UI relabels the column header per area; the DB stores a single `counted_count`.
- `missing_count` (integer, **nullable**; computed on per-area Submit, cleared on per-area Modify). Formula: `max(expected_quantity - counted_count, 0)`.
  > NOTE: The spec writes the formula in `expected - working - not_working` shorthand on every area's Table 2, but Table 2's only counter on each area is the single area-specific count (Working Count / Retrieved Not Inspected Count / …). We interpret the spec as `expected - counted_count`. Clamp at 0 (same reasoning as ASO §4). Override if product wants signed values.
- `created_at`, `updated_at` (timestamps). **No `deleted_at`** — Table-2 rows live with the session and are not retractable individually.

### Index / uniqueness
- Unique `(store_audit_session_id, storage_area_code, vendor_sku_id)` — one row per vendor SKU per area per session.
- Index on `(store_audit_session_id, storage_area_code)`.

### Pre-population at session start (per area)
On `POST /store-audit-sessions`, the server seeds Table 2 with one row per (area, vendor SKU):

- **Source predicate**: every non-deleted Vendor SKU whose `status = 'Active'`, `sku_type.serial_eligible = false`, owned by the Innoviti vendor (matches the ASO slice's Table-2 seed predicate to keep both slices consistent).
- **Expected quantity source per area**:
  - `working`: LEFT JOIN to `accessory_stock_balances` keyed on `(vendor_sku_id, location_id = session.location_id)`; `expected_quantity = COALESCE(asb.working_quantity, 0) + COALESCE(asb.not_working_quantity, 0)`. Matches the ASO slice's seed.
  - `retrieved_not_inspected`, `under_repair`, `scrapped`, `repaired_not_inspected`: `expected_quantity = 0` for all rows. **No** `accessory_stock_balances` column tracks per-area accessory quantities today (the table has only `working_quantity` / `not_working_quantity`). Seeding 0 means the first audit of each non-working area starts blank, and the Admin-approve step writes the audit's `counted_count` back into a future per-area balance column (out of scope for this slice).
  > NOTE: This is the cleanest interpretation that does not require extending `accessory_stock_balances`. Override if product wants per-area accessory balance tracking immediately — that would be a small additive migration adding `retrieved_not_inspected_quantity` / `under_repair_quantity` / `scrap_quantity` / `repaired_not_inspected_quantity` columns to `accessory_stock_balances`, plus the obvious read/write logic.
- Seeded counts: `counted_count = 0`, `missing_count = NULL`.
- All seeding happens **inside the session-creation transaction**.

### Counter update — `PATCH /store-audit-sessions/{id}/areas/{area}/table2/rows/{row_id}`

Request body: `{ "counted_count": int }`. PATCH semantics — only the supplied field is updated.

- Value must be ≥ 0 and ≤ 10 000 → otherwise 422 `bad_format`.
- Allowed only while `store_audit_sessions.<area>_table2_state = 'Editing'` AND `status = 'Incomplete'`; otherwise 409 `store_table2_frozen` / `store_audit_session_frozen`.
- Path `{area}` must equal the row's `storage_area_code`; otherwise 404.
- Bumps `last_activity_at`, writes change-log `(StoreAuditAccessoryRow, row_id, actor, Update)`. No-op PATCH writes nothing.

The UI's `+ / -` buttons are syntactic sugar — they send the new absolute value, not a delta, so two racing clicks cannot drift (same model as ASO).

### Per-area Table-2 Submit / Modify

- `POST /store-audit-sessions/{id}/areas/{area}/table2/submit` — transition the per-area state `<area>_table2_state: Editing → Submitted`. For each row in this area, compute `missing_count = max(expected_quantity - counted_count, 0)` and persist. Writes one change-log `(StoreAuditSession, AIN, actor, Update)`.
- `POST /store-audit-sessions/{id}/areas/{area}/table2/modify` — transition the per-area state `<area>_table2_state: Submitted → Editing`. Sets every row's `missing_count = NULL` **in this area**. Counters re-enabled in the UI. Writes one change-log row.

### Validation rules
- `counted_count` must be a non-negative integer ≤ 10 000.
- A row whose seeded `vendor_sku` later becomes Inactive *during the session* is **kept** in the table (snapshot semantics). The session's table doesn't re-seed on every read.
- Path `{area}` outside the closed set returns 404.

### Business rules / invariants
- A Table-2 row whose `counted_count > expected_quantity` is allowed; `missing_count` is clamped to 0. Surplus is not separately reported in this slice; the Admin-review may surface it.
- All STU writes to `accessory_stock_balances` happen **only when the Admin later approves a PendingReview audit** (separate task file). This slice never mutates that table. It only **reads** it during seeding for the `working` area.

### UI surface
See §7.4 — the per-area Table-2 panel.

### Acceptance
- Session at a location whose Innoviti accessory Vendor SKU catalogue has 6 active rows seeds 6 Table-2 rows **per area** = 30 total rows.
- For the `working` area, a vendor SKU with no `accessory_stock_balances` row seeds with `expected_quantity = 0`, rendered as "0" in the UI. For the other four areas, every vendor SKU seeds with `expected_quantity = 0` by definition.
- Counters start at 0; PATCH to `{counted_count: 5}` returns 200 with the updated row; the change-log gets a single Update row.
- Per-area Submit computes `missing_count = max(0, expected - counted_count)` for that area's rows only.
- Per-area Modify clears that area's `missing_count` to null; the other four areas are untouched.
- A `counted_count` of `-1` returns 422.

---

## 5. Supporting objects

### 5.1 In-flight-audit guard on the User write endpoints

This is **not** a new object and not a schema change. The `users.location_id` column already exists in the Phase 1 schema (`task1.md` §3); under the reshaped hierarchy (`task1.md` §1.12, §3) the only writers of that column for STU users are the **User Create / Modify endpoints** (`POST` / `PATCH /users`). What the Phase 3 STU slice adds is a single **additive guard hook** registered on those endpoints, which fires only when the Store-Audit feature is active.

> NOTE: In the **currently shipped** code this hook is wired onto the old `PUT /locations/{id}/stu-users` handler. The reshaped hierarchy moves it onto `POST` / `PATCH /users`; **code alignment is pending** and is tracked alongside the Phase 1 hierarchy implementation.

#### Behavior
- The hook runs **after** the User endpoint's own field validation (the `location_eligible` type check and the location-vendor-matches-user-vendor rule — `task1.md` §3) and **before** the `location_id` write inside the transaction.
- When the write would **change** an STU's `location_id` (set, clear, or move it), the hook looks up any `store_audit_sessions` row where `auditor_user_id = <this user> AND status IN ('Incomplete','PendingReview') AND deleted_at IS NULL`.
- If a non-terminal session is found, the write short-circuits with HTTP 409 `store_location_in_use`, names the offending user + Store-AIN in the error envelope, and the `location_id` is **not** changed.
- If none is found, the request proceeds to the User update logic untouched.

#### Why a hook rather than editing the endpoint inline
- The User write route should not statically import Phase 3 tables. A guard hook lets the Phase 1 endpoint stay decoupled and lets the Phase 3 migration register its guard at boot.
- The ASO slice adds an identical-shape in-flight check on the same endpoints (`task3-aso.md` §5.1). The two are independent — one fires only for ASO rows, the other only for STU rows (`users.user_type_code` discriminates).
- If the Store-Audit feature is later disabled or removed, unregistering the hook reverts `POST` / `PATCH /users` to its Phase 1 behavior with no code change.

#### Change-log
- Mutations of `users.location_id` ride on the existing per-user `User` change-log row that `POST` / `PATCH /users` already emits (Phase 1, `task1.md` §3). The STU slice adds no extra change-log row for the location field.

#### Acceptance
- A `POST` / `PATCH /users` setting an STU's `location_id` when they have no non-terminal Store-Audit session: returns 200/201 (Phase 1 behavior preserved).
- A `PATCH /users/{id}` that would set/clear/move `location_id` for an STU with an `Incomplete` Store-Audit session: returns 409 `store_location_in_use`, with `{ user_id, audit_index }` in the error fields; the `location_id` is unchanged.
- An STU whose only `store_audit_sessions` rows are `Cancelled` or `Completed`: the change succeeds (only non-terminal statuses block).
- `POST /store-audit-sessions` for an STU whose `users.location_id IS NULL`: returns 422 `store_location_not_assigned`.

### 5.2 Reuse of `accessory_stock_balances` (read-only)

- The table created by the ASO slice (migration 014) is **read** at Store-audit seed time for the `working` area's expected quantities.
- This slice does **not** insert into or update this table. The Admin-approve step (separate task file) is responsible for writing the audit's counts back.
- No new endpoints needed — the existing `routes/accessoryStock.js` `GET /accessory-stock` already serves SA/Admin reads.

---

## 6. Storage areas — summary tab matrix

The five tabs are the unit of UX organization. Per the spec, each tab is logically a mini-audit-session: its own Table 1, its own Table 2, its own Submit/Modify cycle. The session-level Complete button requires **all ten** per-area table states to be `Submitted`.

| Area code                  | UI label                  | Spec sub-section in `docs/Audit_Store_User.docx`                 | Master `state` (PT/BS) | Master `state` (SIM) |
|----------------------------|---------------------------|-------------------------------------------------------------------|------------------------|----------------------|
| `working`                  | Working                   | 3.2.1 Audit Table 1 + 3.2.2 Audit Table 2                         | `Working`              | `Active`             |
| `retrieved_not_inspected`  | Retrieved Not Inspected   | 3.2.3 Audit Table 1 + 3.2.4 Audit Table 2                         | `Retrieved Not Inspected` | (none — see §1.8 NOTE 2) |
| `under_repair`             | Under Repair              | 3.2.5 Audit Table 1 + 3.2.6 Audit Table 2                         | `Under Repair`         | (none)               |
| `scrapped`                 | Scrapped                  | (Listed in tab list; details inferred — see §1.8 NOTE 1)          | `Scrap`                | (none)               |
| `repaired_not_inspected`   | Repaired Not Inspected    | 3.2.7 Audit Table 1 + 3.2.8 Audit Table 2                         | `Repaired Not Inspected` | (none)             |

### 6.7 Cancellation visibility
- A cancelled Store-Audit session row has `status = 'Cancelled'` and `deleted_at = NOW()`. It does not appear in the (future) Store-Audit Reports listings. It is retained for `change_log` forensics and to preserve AIN ordering.

---

## 7. UI surface — Store-Audit screen

### 7.1 Page layout & routing
- **New top-level nav entry**: `Store Audit`. Rendered only when `user.user_type_code === 'STU'`. SA, Admin, ASO, and other operational types do not see it.
- Path: `/store-audit` (single route; mirrors the `/audit` single-route pattern from the ASO slice §6.1).
- New page file: `code/frontend/src/pages/StoreAudit.jsx`. New API client helpers under `code/frontend/src/lib/api.js` (added alongside existing helpers; not replacing them).
- The page subscribes to `GET /store-audit-sessions/current` on mount.
- Three render states based on the response:
  1. `{ status: 'none' }` → render the **Start** button: `Start Audit Session — <First Last>`. Clicking calls `POST /store-audit-sessions` and re-renders into state 3.
  2. `{ status: 'PendingReview', audit_index }` → render the block message verbatim from the spec: `Previous audit <AIN> is awaiting Admin review. Cannot start a new audit by the same user until the previous audit review is closed.` No Start button. No tabs. Read-only banner.
  3. `{ status: 'Incomplete', …full session payload… }` → render the active PAR (sections 7.2 + 7.3 + 7.4 below) with the Complete + Cancel buttons at the top.
- The auto-suspended banner (small grey strip, not a modal) shows when `auto_suspended_at IS NOT NULL`: `Auto-suspended after 30 minutes of inactivity — resume by scanning or editing below.` Clears on first interaction.

### 7.2 Session header + area tabs
- Top of the page: session header line `Provisional Audit Report (PAR) <AIN> · <Location Name>`.
- Immediately below the header, two buttons: `Complete Audit Session <AIN>` and `Cancel Audit Session <AIN>`. Both go through `<ConfirmModal>` (same component used elsewhere in the app).
- Below the buttons: a horizontal tab bar with five tabs in fixed order: **Working | Retrieved Not Inspected | Under Repair | Scrapped | Repaired Not Inspected**.
- Tab indicators per tab:
  - Small dot in **purple** when that area has any `*_state = Submitted`.
  - Small dot in **grey** when both tables are `Editing`.
  - Both colors come from the existing Phase 1 §1.2 palette; no new tokens.
- Switching tabs is a client-side state change only — no API call beyond the initial session load. The session payload contains all five areas' rows.

### 7.3 Per-area Table 1 panel
- Header: `Provisional Audit Report (PAR) <AIN> · Table 1 for <Area Label> Serial Type SKUs: Payment Terminals, Base Stations, and SIM Cards · audit status`.
- Instruction line: `Scan or punch in the S.No. of any of the above type of SKUs.`
- **Scan-target picker**: dropdown showing the available Vendor SKUs (serial-eligible) + SIM Innoviti SKUs, fetched via `GET /store-audit-sessions/{id}/areas/{area}/table1/scan-targets`. The user picks one before the scan input becomes active. This mirrors the ASO slice's picker (`code/frontend/src/pages/Audit.jsx`).
- **Scan input + Submit button**: an `<input>` for the serial plus a `Submit` button next to it. Enter key on the input is equivalent to clicking Submit (barcode scanners suffix Enter). After each successful scan the input is cleared and refocused.
- **Duplicate error**: when the API returns 409 `duplicate_scan`, the toast displays the spec wording: `<S.No.> has already been audited in this session.` The scan input is **not** cleared (so the user can correct without retyping).
- **Table** with the spec's exact column set, in order:
  | Column                  | Source                                                                                  |
  |-------------------------|-----------------------------------------------------------------------------------------|
  | Vendor SKU Number       | `vendor_sku_number_snapshot` (or `sku_number_snapshot` for SIM rows)                    |
  | Vendor SKU Name         | `vendor_sku_name_snapshot` (or `sku_name_snapshot` for SIM rows)                        |
  | Expected Item S.No.     | `expected_serial_number`                                                                |
  | Unexpected Item S.No.   | `unexpected_serial_number`                                                              |
  | Unregistered Item S.No. | `unregistered_serial_number`                                                            |
  | Matched                 | `matched` → green tick (✓) when true, blank when false                                  |
  | Missing                 | `missing` → red cross (✗) when true (only after per-area table Submit), blank otherwise |
  | Remarks                 | `remarks`                                                                               |
  | Working / Not Working   | `working_status` toggle — two-state slider; default `Working`                            |
- Rows sort by: pre-populated expected rows first (in original seed order), then Unexpected rows by `scanned_at`, then Unregistered rows by `scanned_at`. Predictable order makes resumption painless.
- Table-header **Submit** button (per-area):
  - Default state: `Submit`. Clicking calls `POST /store-audit-sessions/{id}/areas/{area}/table1/submit`; on success, button label flips to `Modify`, the scan input + scan-Submit go disabled, and Missing flags appear as red ✗ on unmatched expected rows.
  - Modify state: `Modify`. Clicking calls `POST /store-audit-sessions/{id}/areas/{area}/table1/modify`; on success, label flips back to `Submit`, scan input re-enables, Missing flags clear.
  - The Modify button can be clicked any number of times. Each toggle writes a single change-log row.

### 7.4 Per-area Table 2 panel
- Visible only **after** this area's Table 1 has been Submitted at least once (per the spec: "Once a user has pressed the Submit button, a Table 2 opens below"). This gate is **per-area**, not global.
- Header: `Provisional Audit Report (PAR) <AIN> · Table 2 for <Area Label> Accessories · audit status`.
- Instruction line: `Increment the count.`
- **Table** with the spec's exact columns. The middle counter column header changes per area:
  | Column                 | Source                                                                  |
  |------------------------|-------------------------------------------------------------------------|
  | Vendor SKU Number      | `vendor_sku_number_snapshot`                                            |
  | Vendor SKU Name        | `vendor_sku_name_snapshot`                                              |
  | Expected Item Qty      | `expected_quantity` (rendered as "0" when zero)                         |
  | `<area-specific label>` | `counted_count` with `−` / counter / `+` buttons                         |
  | Missing Count          | `missing_count` (blank while Editing, populated after per-area Submit)   |
- Per-area counter column labels (matching the spec verbatim):
  - `working` → `Working Count`
  - `retrieved_not_inspected` → `Retrieved Not Inspected Count`
  - `under_repair` → `Under Repair Count`
  - `scrapped` → `Scrap Count`
  - `repaired_not_inspected` → `Repaired Not Inspected Count`
- The `−` button is disabled at 0. The `+` button is disabled at 10 000.
- Each click is one PATCH (the API takes absolute counts, not deltas — the UI computes `current ± 1` before sending).
- Table-header **Submit / Modify** button: identical interaction model to Table 1's, hitting `/areas/{area}/table2/submit` and `/areas/{area}/table2/modify`. On per-area Submit the counters disable and Missing Count populates; on per-area Modify they re-enable and Missing Count clears.

### 7.5 Complete / Cancel buttons
- Both buttons render at the top of the page next to the AIN header, visible from the moment the session is `Incomplete`. Both require **confirmation** via the existing `<ConfirmModal>` component.

  - **Complete Audit Session <AIN>**:
    - Click → modal: `Complete this audit and submit the PAR for Admin review? This freezes all five storage areas and cannot be undone from this screen.` Buttons: `Cancel` / `Complete` (primary).
    - On confirm → `POST /store-audit-sessions/{id}/complete`. On 409 `store_audit_tables_not_submitted`, the modal closes and a toast surfaces the API message, which names every unsubmitted `(area, table)` pair (e.g., `Pending: (Working, Table 2), (Scrapped, Table 1)`).
    - On 200, the screen re-renders into the `PendingReview` block state (§7.1 state 2). Toast: `Audit AIN-… submitted for Admin review.`

  - **Cancel Audit Session <AIN>**:
    - Click → modal (with `danger` flag): `Cancel this audit? The PAR will not be retained. This cannot be undone.` Buttons: `Keep auditing` / `Cancel audit`.
    - On confirm → `POST /store-audit-sessions/{id}/cancel`. On 200, the screen re-renders into the `{ status: 'none' }` start state (§7.1 state 1). Toast: `Audit AIN-… cancelled.`

### 7.6 Responsive & accessibility
- Page conforms to Phase 1 §1.3 breakpoints. Below 640 px the tabs collapse into a `<select>` dropdown (same pattern Phase 2's Load Stock uses for its kind picker on mobile). Below 480 px the tables collapse to the `.card-table` mobile pattern with `data-label="…"` per cell.
- The scan input is `type="text"` with `autocomplete="off"`, `inputmode="text"`, font-size ≥ 16 px. On mobile, the input gets `enterkeyhint="send"`.
- The `±` counter buttons have a tap target ≥ 44 × 44 px on touch screens.
- All toggle / submit / modify / counter actions have keyboard equivalents (Tab → Space).
- The Auto-Suspended banner is `role="status" aria-live="polite"`.
- Tab bar uses `role="tablist"` with `aria-selected` on the active tab. Each table panel is a `role="tabpanel"` with `aria-labelledby` pointing at its tab.

### 7.7 API parity
- Every Store-audit operation is reachable via REST under `/store-audit-sessions/...` (§2, §3, §4). The UI is a thin client; a script can run a complete five-area audit end-to-end without ever rendering the page.

---

## 8. Validation Rules (consolidated)

### 8.1 Error code → user-facing message

| Code                                | HTTP | Message template                                                                                                          |
|-------------------------------------|------|---------------------------------------------------------------------------------------------------------------------------|
| `store_location_not_assigned`       | 422  | `You do not have a store location assigned. Ask an Admin to assign one before starting an audit.`                          |
| `store_location_user_not_stu`       | 422  | `Store locations can be assigned only to Store Users.`                                                                    |
| `store_location_vendor_not_innoviti`| 422  | `Store locations must belong to the Innoviti vendor.`                                                                     |
| `store_location_in_use`             | 409  | `Cannot change or remove the store location while user has an active or pending audit (<AIN>).`                            |
| `store_audit_pending_review_block`  | 409  | `Previous audit <AIN> is awaiting Admin review. Cannot start a new audit by the same user until the previous audit review is closed.` |
| `duplicate_scan`                    | 409  | `<S.No.> has already been audited in this session.`                                                                       |
| `store_audit_session_frozen`        | 409  | `This audit is awaiting Admin review and cannot be modified.`                                                             |
| `store_audit_session_cancelled`     | 410  | `This audit was cancelled and cannot be modified.`                                                                        |
| `store_table1_frozen`               | 409  | `Table 1 for this area has been submitted. Press Modify to re-open it before changing scans.`                              |
| `store_table2_frozen`               | 409  | `Table 2 for this area has been submitted. Press Modify to re-open it before changing counts.`                             |
| `store_audit_tables_not_submitted`  | 409  | `All five storage areas must have both Table 1 and Table 2 submitted before completing the audit. Pending: <list>.`        |
| `scan_target_required`              | 422  | `Pick a Vendor SKU (or SIM SKU) before scanning.`                                                                          |
| `scan_target_invalid`               | 422  | `The selected target is not a serial-type SKU.`                                                                            |
| `required_missing`                  | 422  | `Required field '<field>' missing.`                                                                                       |
| `bad_format`                        | 422  | `Value '<raw>' for '<field>' is not a valid <expected_type>.`                                                              |

The error envelope shape matches the Phase 1 / Phase 2 / ASO convention: `{ error: <human message>, code: <machine code>, fields?: { … } }`. The frontend's existing `fieldMap` / `error-banner` pattern is reused verbatim.

### 8.2 Concurrent-session guard
- The partial unique index on `(auditor_user_id) WHERE status IN ('Incomplete','PendingReview')` is the only correctness backstop. The API layer additionally checks before INSERT to return the cleaner 200-on-resume / 409-on-pending-review behavior, but if two requests reach INSERT simultaneously, the loser's INSERT fails with a unique-violation; the handler catches it and retries the read path (resume or 409). Same pattern as ASO §7.2.

### 8.3 Transaction boundaries
- Every mutating endpoint runs in a single transaction containing **both** the audit-state change and the change-log insert(s). Session creation additionally contains the bulk Table-1 + Table-2 seeds (five Table-1 inserts + five Table-2 inserts = 10 batched INSERTs inside the transaction). Failure at any point rolls back the whole thing.
- Background scheduler (§1.5) runs each suspended-state flip in its own transaction; no scheduler write may overlap with a user write on the same session (advisory lock keyed on `store_audit_session_id`).

### 8.4 Idempotency
- `POST /store-audit-sessions` is naturally idempotent for a single user thanks to the resume-existing-session rule.
- `POST /store-audit-sessions/{id}/cancel` is idempotent.
- `POST /store-audit-sessions/{id}/complete` is **not** idempotent against a `PendingReview` row — re-posting returns 409 `store_audit_session_frozen`. Intentional.
- `POST /store-audit-sessions/{id}/areas/{area}/table1/submit` and `…/modify` are idempotent against the current state (Submit on an already-Submitted table returns 200 with no extra change-log row).
- Scan endpoint is **not** idempotent against repeats — the duplicate-scan guard is the mechanism that makes accidental double-scans safe.

---

## 9. Change-log integration (cross-cutting recap)

Per Phase 1 §10's minimal model, the Store-Audit slice writes exactly one `change_log` row per state change:

| Trigger                                                              | object_type            | object_id          | action       |
|----------------------------------------------------------------------|------------------------|--------------------|--------------|
| `POST` / `PATCH /users` (Phase 1 — listed for completeness; the STU row whose `location_id` changes) | `User` | `<user_index>` | `Create / Update` |
| `POST /store-audit-sessions`                                         | `StoreAuditSession`    | `<AIN>`            | `Create`     |
| `POST /store-audit-sessions/{id}/areas/{area}/table1/scan` (any path) | `StoreAuditSerialRow`  | `<row_id>`         | `Create` or `Update` |
| `PATCH /store-audit-sessions/{id}/areas/{area}/table1/rows/{row_id}` | `StoreAuditSerialRow`  | `<row_id>`         | `Update`     |
| `POST /store-audit-sessions/{id}/areas/{area}/table1/submit`/`…/modify` | `StoreAuditSession` | `<AIN>`            | `Update`     |
| `PATCH /store-audit-sessions/{id}/areas/{area}/table2/rows/{row_id}` | `StoreAuditAccessoryRow` | `<row_id>`       | `Update`     |
| `POST /store-audit-sessions/{id}/areas/{area}/table2/submit`/`…/modify` | `StoreAuditSession` | `<AIN>`            | `Update`     |
| `POST /store-audit-sessions/{id}/complete`                           | `StoreAuditSession`    | `<AIN>`            | `Update`     |
| `POST /store-audit-sessions/{id}/cancel`                             | `StoreAuditSession`    | `<AIN>`            | `SoftDelete` |

- No per-field diff (consistent with Phase 1 §10).
- The change-log `object_type` column is free-form `TEXT`; the four new values land as code-only additions. No migration required for the enum.
- A PATCH that submits the same value as currently stored (idempotent no-op) does **not** write a change-log row.

---

## 10. Files to add (suggested layout — does not edit any existing file)

This list maps the work above to concrete files. Every file is **new**; no file in the existing tree is edited *except* the two thin integration points called out at the end.

### Backend
- `code/backend/src/migrations/016_phase3_stu.sql` (Phase 3 STU slice migration; numbered after the SIM owner-parity migration 015):
  - `store_audit_sessions` table (with ten per-area `*_state` columns and indexes).
  - `store_audit_serial_rows` table (with `storage_area_code`, indexes, exactly-one-of category check, and `master_kind` check).
  - `store_audit_accessory_rows` table (with `storage_area_code`, unique `(session, area, vendor_sku_id)` index).
  - **No** `user_store_locations` table — assignment uses the Phase 1 `users.location_id` column instead.
  - All idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- `code/backend/src/routes/storeAuditSessions.js` — all session, scan, row PATCH, submit, modify, complete, cancel endpoints (§§2–4); exports `runStoreAuditSuspensionJob` and the `registerStoreLocationGuard()` function that wires §5.1's hook into `POST` / `PATCH /users` at boot.
- **No** `code/backend/src/routes/userStoreLocations.js` — earlier drafts proposed it; dropped. Location assignment uses the Phase 1 `routes/users.js` (the User form's `location_id` field, `task1.md` §3).
- **Edits to existing files (the thin integration points):**
  - `code/backend/src/lib/auth.js` — append a new exported `requireStu` middleware next to the existing `requireAso`. No existing export is modified.
  - `code/backend/src/server.js` — mount the new `storeAuditSessions` router, call `registerStoreLocationGuard()` to register §5.1's hook, and start the new `runStoreAuditSuspensionJob` timer alongside the existing ASO suspension timer. ~four lines.
  - `code/backend/src/lib/ids.js` — `nextIndex` already accepts arbitrary `kind` strings via the `counters` table; the new `'store_audit'` kind is data-only (an initial counter row inserted on first call). Add a one-line seed in `seed.js` if you want the counter to start at exactly `50001` on a fresh install; otherwise it starts at `1` and the first AIN is `AIN-00001`, which is fine functionally but inconsistent with §1.6.

### Frontend
- `code/frontend/src/pages/StoreAudit.jsx` — the page (§7).
- **No** new admin page for store-location assignment — the Phase 1 Manage Users form's Location picker (shown for `location_eligible` types; `task1.md` §3 UI surface) is where assignment lives.
- **Edits to existing files:**
  - `code/frontend/src/lib/api.js` — append the new API client helpers (`createStoreAuditSession`, `getCurrentStoreAuditSession`, `scanStoreAuditTable1`, etc.) next to the existing ASO helpers. No existing helper is modified.
  - `code/frontend/src/components/Layout.jsx` — add the `Store Audit` nav entry, rendered only when `user.user_type_code === 'STU'`. One conditional `<NavLink>`.
  - `code/frontend/src/main.jsx` — add the `/store-audit` route. One `<Route>`.

### Tests
- `code/backend/test/storeAuditSessions.test.js` — covers all acceptance criteria in §2, §3, §4, plus the §5.1 guard-hook behavior on the Phase 1 `POST` / `PATCH /users` endpoints (in-flight session blocks a location change, etc.).
- `code/frontend/src/pages/StoreAudit.test.jsx` (or equivalent under the existing test layout) — covers §7 render states, tab switching, per-area submit/modify, complete/cancel modals.

---

## 11. Open product questions (defaults chosen; override at any point)

1. **Scrapped area details** — chose to include Scrapped as the fifth area with the same table model, mapped to Master `state = 'Scrap'`. Override if Scrapped should be excluded or have different fields.
2. **SIM-to-area mapping** — chose `working` only (SIM state `Active`). Override if SIMs should appear in additional tabs or under different states.
3. **Per-area expected qty for non-working accessory areas** — chose 0 (no per-area accessory balance tracking yet). Override to extend `accessory_stock_balances` with per-area columns now rather than later.
4. **AIN counter** — chose a separate `'store_audit'` counter starting at `AIN-50001`. Override to share the ASO `'audit'` counter (a single global AIN sequence).
5. ~~**Locked-Store-Location join table** — chose a new `user_store_locations` table. Override to share `user_audit_locations` with the ASO slice via a discriminator column.~~ **Resolved (later revision):** dropped both proposals; STU's location uses the Phase 1 `users.location_id` column (`task1.md` §3) and assignment happens on the User form (`POST` / `PATCH /users`). The user-type column on `users` is the discriminator.
6. **Missing-count clamping** — chose `max(expected - counted, 0)`. Override to surface signed values ("found extras").
7. **Auto-suspension behavior** — chose "stays `Incomplete`, just sets `auto_suspended_at`" (mirrors ASO). Override if 30-min idle should hard-transition to a distinct status for STU.
8. **Cross-area duplicate-scan guard** — chose per-(session, area, scope) scoping. Override if a serial scanned in one area must block being scanned again in any other area of the same session.
9. **Wrong-Area remark** — chose not to introduce a new reserved phrase for in-Master-row-but-different-state. Override to add `Wrong Area` as a third reserved phrase alongside `Wrong Location` and `Recovered`.
10. ~~**Locked-Store-Location UI surface** — chose the in-row link on the existing Users page. Override for a dedicated admin page (`StoreUserStoreLocations.jsx`).~~ **Resolved (later revision):** assignment lives on the Manage Users form's Location picker (`task1.md` §3 UI surface) — the same picker the ASO slice uses. No dedicated admin page.

---

## 12. Out of scope for this slice

- **Admin review of PendingReview Store-audits** — the Approve / Reject flow that transitions `PendingReview → Completed` lives in the separate `docs/Audit_Report.docx` → its own task file. That flow is the one that:
  - writes `last_audited_at`, `present_location_id`, `present_location_since` back into the three Master tables for every matched serial-row;
  - writes `working_quantity` / `not_working_quantity` (and any future per-area columns) back into `accessory_stock_balances`;
  - sets `store_audit_sessions.status = 'Completed'`.
- **Store User review of an ASO's PendingReview audit** — that closes the loop on the ASO slice's `PendingReview` state and is described in a separate task file (referenced by `task3-aso.md` §10 as `task/task3-stu.md`, which historically meant "STU reviews ASO"). This slice **does not** implement that; rename / split that other task file separately so naming stays unambiguous.
- **Audit Reports screen** — the Reports tab and the Approved / Pending / Incomplete listings for Store-audits live in `docs/Audit_Report.docx` → separate task file.
- **Activation of ALU, RLU, FNU, LOU user types** — out of scope for Phase 3.
- **Bulk-load of expected stock at audit time** — the audit reads existing Master tables; it does not import new stock. Stock loading remains the Phase 2 Load Stock journey.
- **Per-field old→new diff in the audit's change log** — Phase 1 §10 invariant; not adding for Phase 3.
- **Editing or deleting individual Table-1 rows directly** — the per-area Modify button is the only retraction mechanism.
- **Audit on behalf of another user** — SA/Admin cannot start, edit, or complete a Store-audit owned by an STU. Read-only access only.
- **Multi-location audit in one session** — each session is locked to one location (the value of `users.location_id` snapshotted at session start). Cross-location reconciliation is a future-phase concern.
- **Offline / queued scans when the network drops mid-session** — every scan is an online POST. Offline mode is not in scope.
- **A full Accessory Master object** — `accessory_stock_balances` (introduced by the ASO slice) is the minimum-viable quantity tracker. A first-class Accessory Master is a future-phase concern.
- **Moving rows between area tabs** — `storage_area_code` is immutable. If an auditor scans into the wrong tab, the correct fix is per-area Modify + re-scan in the right tab, not a cross-tab move.
- **Parallel `user_store_locations` join table** — explicitly removed in this revision. The STU's location lives on the Phase 1 `users.location_id` column (`task1.md` §3). The `/users/{id}/store-location` endpoints from earlier drafts no longer exist; assignment happens on the User form (`POST` / `PATCH /users`).
- **Any DDL against the `users` table in Phase 3 STU** — `users.location_id` is delivered by Phase 1. The Phase 3 STU slice makes no schema change to `users`.
