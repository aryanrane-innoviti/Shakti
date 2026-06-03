# Shakti Supply Chain Management System — Implementation Tasks (Phase 3, ASO slice)

## How to read this document

This document is the build-ready task breakdown for the **ASO User audit-session journey** that ships in Phase 3 of Shakti. It covers exactly what `docs/Audit_Aso_User.docx` specifies: how an ASO User starts, runs, suspends, completes, or cancels an Audit Session, and how the Provisional Audit Report (PAR) is built up across **Table 1 (serial-type SKUs)** and **Table 2 (accessory SKUs)**.

It deliberately **excludes**:
- The Store User review flow (`docs/Audit_Store_User.docx` — separate task file).
- The Audit Report screens (`docs/Audit_Report.docx` — separate task file).
- Any non-audit Phase 3 work.

**Hard constraints inherited from prior phases:**
- Phase 3 must be built **without restructuring any Phase 1 or Phase 2 requirement, table, or route**. The ASO slice is **additive**: new tables, new endpoints, new screens. No existing column, constraint, index, seed value, or route response shape is renamed, narrowed, or removed.
- The only Phase 1/2 surface area Phase 3 touches **at all** is:
  - The `users.location_id` column (added by migration `017_users_location_id.sql`, nullable, FK to `locations`, indexed by `idx_users_location` — spec'd as Phase 1 in `task1.md` §3). Phase 3 is the first phase that **reads** it (to determine which location an ASO audits) and the first phase that **enforces the in-flight-audit guard** on changes to it. The older parallel `user_audit_locations` join table was removed in `018_drop_user_audit_locations.sql`; there is **one ASO, one `users.location_id`**, no per-session override.
  - The `change_log.object_type` column is free-form `TEXT` already (no enum, no CHECK), so the three new values used by this slice (`AuditSession`, `AuditSerialRow`, `AuditAccessoryRow`) need **no** migration to be accepted.
  - The three Master tables' `present_location_id`, `present_location_since`, and `last_audited_at` columns — these were created NULL-at-load **specifically so Phase 3 Audit could populate them** (Phase 2 §1.3, §1.9). Phase 3 only **reads** them (Table 1 seeding, the scan vendor-recovery path); the write-back happens in the Store-review slice on Completed approval. No DDL change.
- **API-first**: every audit operation — starting a session, submitting scans, updating counters, submitting/modifying a table, completing/cancelling, resuming — is a REST endpoint. The UI in §6 is a thin client over those endpoints.
- All Phase 1 Foundations (auth, soft-delete, change log, API parity, branding, responsive design, backup) carry forward unchanged.

If a Phase 3 requirement appears to need an in-place Phase 1/2 change beyond the points above, halt and surface the conflict to product before implementing.

Out-of-scope items are listed in the footer. Ambiguities are marked inline with `> NOTE:` when a reasonable default was chosen; resolved product decisions taken on the source spec are recorded in §1.9.

> NOTE: This revision aligns the document to the **currently implemented** ASO slice (`code/backend/src/routes/auditSessions.js`, `migrations/014_phase3_aso.sql`, `code/frontend/src/pages/Audit.jsx`). Two earlier interpretations were reversed in code and are corrected throughout: (a) **Table 2 now seeds every accessory Vendor SKU from any vendor, Active or Inactive** — the Innoviti-only + Active-only gate is gone; and (b) **Unregistered serial rows are stored with `matched = FALSE`**, not `TRUE`. The ASO-facing view was also rebuilt: Table 1 is rendered as **two sub-tables** (a Summary counts ledger and a Serial-detail log), Vendor SKU **Number** and **Remarks** are hidden from the ASO, and scanning is **SKU-first** (pick a model, then enter/scan the serial) with an optional camera 1D barcode reader.

---

## 1. Foundations (Phase 3 / ASO)

### 1.1 Additive-only rule
- No Phase 1 or Phase 2 source file is restructured as part of Phase 3 ASO work. **Zero DDL changes** to any existing table. New things introduced (all in `014_phase3_aso.sql`):
  - New tables (`audit_sessions`, `audit_session_serial_rows`, `audit_session_accessory_rows`, `accessory_stock_balances`).
  - New routes under `/audit-sessions/...` and a read-only `GET /accessory-stock`.
  - A new top-level **Audit** nav entry and audit screen that renders **only** for users whose `user_type_code = 'ASO'`.
- Phase 3 may **read** every Phase 1/2 table (Users, Vendors, Locations, SKUs, Vendor SKUs, the three Master tables) and must not alter any of their schemas. The `users.location_id` column that this slice depends on is already part of the schema (migration 017; see `task1.md` §3) — Phase 3 simply consumes it.
- The two "writes against Phase 1/2" exceptions:
  - One additive in-flight-audit check inside the existing `PUT /locations/{id}/assigned-users` endpoint (the only Phase 1 endpoint that mutates `users.location_id` — `routes/locations.js`): a new query that rejects any assignment / unassignment / reassignment touching a non-admin user who has a non-terminal `audit_sessions` row. The check is **inline in the handler body** (`locations.js` lines 283–302); no separate hook registry exists (see §5.1).

    > NOTE: The registered route is `PUT /locations/{id}/assigned-users` (`routes/locations.js`). `auditSessions.js` and this document both use that name. If `task1.md` §9 still labels it `aso-users`, that label is the stale one — the live registration is `assigned-users`.
  - The three Master tables' `present_location_id`, `present_location_since`, and `last_audited_at` columns are **written** (not altered) when a PendingReview audit later becomes Completed (Store user approval). For this ASO slice, those writes happen in the Store-review task file; the ASO slice only stages the values inside the PAR.

### 1.2 ASO User type activation
- The `ASO` (Area Service Officer) user type was seeded in Phase 1 §2 but had **no permissions** anywhere in Phase 1 or Phase 2. Phase 3 activates ASO **only** for audit endpoints (§2–§4) and the Audit screen (§6). ASO still has **no** access to any Section 1 or Section 2 object.
- The activation is purely route-level: a `requireAso()` middleware (added in `lib/auth.js` alongside the existing `requireAdmin` / `requireAdminRead` helpers — append-only, the existing functions are not edited) returns 401 `{error:'unauthenticated'}` with no session, else 403 `{error:'forbidden'}` unless `req.session.user_type_code === 'ASO'`.
- SA and ADMIN keep their existing Phase 1/2 access unchanged. They additionally gain **read-only** access to audit sessions for oversight via `requireAdminRead` on the list + get-one routes (see §1.8). They have **no** mutating audit route.
- All other operational user types (STU, ALU, RLU, FNU, LOU) remain dormant in this task file. STU activation lands in the Store-review task file; the rest stay dormant.

### 1.3 ASO User Location (on the existing users table)
- An ASO **cannot start an Audit Session** unless they have `users.location_id` populated. The audit start endpoint enforces this — there is no separate "Locked Audit Location" object, table, or join. The location lives directly on the user row, on the `users.location_id` column (migration 017; `task1.md` §3).
- The per-user validation for location assignment (user exists & active, not an admin, and belongs to the **same vendor as the location**) is **already enforced by the Phase 1 `PUT /locations/{id}/assigned-users` endpoint** (`routes/locations.js`). Phase 3 does not duplicate those checks. (There is no Innoviti-specific or ASO-type-specific gate — the endpoint assigns any non-admin user whose vendor matches the location.)
- The location of an ASO can be changed by an SA or Admin **only when there is no `Incomplete` or `PendingReview` audit session for that ASO**. This guard is the **one new piece of behavior** Phase 3 adds to the Phase 1 location-assignment endpoint — see §5.1. It cannot live in Phase 1 because the `audit_sessions` table doesn't exist until Phase 3.
- No new endpoint is introduced for assigning the location — `PUT /locations/{id}/assigned-users` (`routes/locations.js`) is the sole writer of `users.location_id`. Phase 3 adds one inline in-flight-audit check to that handler.

### 1.4 Audit Session lifecycle
There are exactly four lifecycle states, recorded in `audit_sessions.status` (CHECK enum in migration 014):

| Status          | Meaning                                                                                                 | Visible to ASO? | Editable? |
|-----------------|---------------------------------------------------------------------------------------------------------|-----------------|-----------|
| `Incomplete`    | Session exists; user has not yet pressed Complete or Cancel. Tables may be partially filled.            | Yes — resumable | Yes       |
| `PendingReview` | User pressed Complete. PAR is frozen; awaiting Store-user review (the Store-review task closes the loop). | Yes — read-only (block banner only) | No        |
| `Cancelled`     | User pressed Cancel. The PAR is **not retained for reporting** (see §1.9). Row is soft-deleted (`deleted_at` set); kept for forensics. | No              | No        |
| `Completed`     | Store user approved (closes the loop). **Set in the Store-review task file** — Phase 3 ASO never writes this. Listed here so the enum is complete from the start. | Read-only       | No        |

**One non-terminal audit session per user (mutual exclusion):**
- A given `user_id` may have at most **one** non-terminal `audit_sessions` row, where non-terminal means `status IN ('Incomplete','PendingReview')`. This spans **both** Incomplete and PendingReview — not just Incomplete.
- Enforced two ways: the partial unique index `idx_audit_sessions_one_open ON (auditor_user_id) WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL` (the DB backstop) **and** an application pre-check (`loadCurrentNonTerminal`) that gives the clean resume / 409 behavior before the insert.
- Attempting to start a session while a `PendingReview` exists returns the exact source-spec error string: `Previous audit <AIN> is awaiting Store review. Cannot start a new audit by the same user until the previous audit review is closed.` (HTTP 409, code `audit_pending_review_block`, fields `{audit_index}`).
- Attempting to start a session while an `Incomplete` exists silently **resumes** it (returns the existing session with both tables expanded, HTTP 200 — no new row). This matches the spec's "the session Provisional Audit Report (PAR) is shown and the user can continue their audit." Note the resume path is **Incomplete-only**; a `PendingReview` is **blocked**, not resumed.

### 1.5 30-minute inactivity rule
- Every write to a session bumps `audit_sessions.last_activity_at` to `NOW()` (via `bumpActivity` on scans / row PATCHes, and inline on every submit / modify / complete `UPDATE`), and clears `auto_suspended_at` back to `NULL`.
- Phase 3 ASO introduces a **5-minute sweep** (`runAuditSuspensionJob`, wired from `server.js` on a 5-minute timer) that **does nothing destructive** to `Incomplete` sessions: their status stays `Incomplete`. What it does:
  - Sets `auto_suspended_at = NOW()` on any `Incomplete`, non-deleted session whose `last_activity_at < NOW() - INTERVAL '30 minutes'` and whose `auto_suspended_at IS NULL`.
  - The guard `auto_suspended_at IS NULL` makes the job idempotent. It is a single set-based `UPDATE` on the pool (backed by the partial index `idx_audit_sessions_suspend`); each swept row gets `auto_suspended_at = NOW(), updated_at = NOW()`. It does **not** change `status`, touch either child table, take any advisory lock, or write a `change_log` row.
  - When the ASO reopens the session (any write), `auto_suspended_at` is cleared.
- Because every scan and counter increment is persisted server-side immediately (§3, §4), the user genuinely "loses nothing" on inactivity — the session simply becomes auto-suspended. Reopening the Audit tab continues from the same state.
- The source spec phrases this as "the audit session PAR is automatically submitted and its status under Reports will show as Incomplete." We interpret that as "the partial PAR becomes persisted/visible," not "the status changes." The status remains `Incomplete` either way — there is no separate `AutoSubmitted` state. The `auto_suspended_at` timestamp is the only signal that the user idled out.

> NOTE: Describe the mechanism as "a 5-minute sweep that auto-suspends sessions idle > 30 min," **not** "a 30-minute job." The cadence (every 5 min) and the idle threshold (30 min) are distinct.

### 1.6 Audit Index (AIN)
- Each session gets an immutable `audit_index` of format `AIN-NNNNN`, starting at `AIN-10001`, monotonic, generated by the existing `lib/ids.js::nextIndex('audit', client)` helper (`audit` kind: `{prefix:'AIN', start:10001, pad:5}`) on the existing `counters` table. No schema change — `counters` already accepts arbitrary names.
- AIN is allocated at `POST /audit-sessions` time (inside the create transaction) and never reused, even on `Cancelled` sessions (so the visible AIN sequence has gaps where cancellations occurred. That's fine — the spec only requires monotonicity).

### 1.7 Change log integration
- Per Phase 1 §10 minimal-change-log model: every state-changing audit action writes exactly **one** row to `change_log` via `logChange(object_type, object_id, actor, action, client)`. Action enum reused without extension. `object_id` is stored as `String(...)` — the AIN for session-level rows, the numeric PK for serial/accessory rows:
  - Session create → `(AuditSession, <AIN>, ASO actor, Create)`.
  - Table-1 scan that flips an expected row → `(AuditSerialRow, <row_id>, ASO actor, Update)`; a scan that inserts an Unexpected **or** Unregistered row → `(AuditSerialRow, <row_id>, ASO actor, Create)`.
  - Table-1 row PATCH (working_status / remarks) → `(AuditSerialRow, <row_id>, ASO actor, Update)` — **only when a field actually changes**.
  - Table-2 counter PATCH → `(AuditAccessoryRow, <row_id>, ASO actor, Update)` — **only when a field actually changes**.
  - Table-1/Table-2 Submit and Modify → `(AuditSession, <AIN>, actor, Update)`.
  - Complete → `(AuditSession, <AIN>, actor, Update)` (status transition).
  - Cancel → `(AuditSession, <AIN>, actor, SoftDelete)`.
  - Changing a user's `users.location_id` is logged by the `PUT /locations/{id}/assigned-users` handler itself: it emits one `(User, <user_index>, actor, Update)` row per affected user inside its own transaction (no new object_type added). Phase 3's only addition to that handler is the in-flight-audit guard, not the change-log emission.
- All writes happen **inside the same transaction** as the originating mutation (Phase 1 §10 invariant). A failed change-log insert rolls back the audit mutation. The duplicate-scan and scan-target-error paths throw **before** any insert, so they write no row; a no-op PATCH returns **before** `logChange`, so it writes no row.
- `change_log.object_type` is free-form `TEXT` (no enum / no CHECK), so the three new values (`AuditSession`, `AuditSerialRow`, `AuditAccessoryRow`) require **no** schema migration to be accepted.

### 1.8 Authorization summary for Phase 3 (ASO slice)

| Endpoint                                                            | SA      | Admin   | ASO  | Other operational |
|---------------------------------------------------------------------|---------|---------|------|-------------------|
| `POST /audit-sessions`                                              | 403     | 403     | **200/201** | 403         |
| `GET /audit-sessions/current`                                       | 403     | 403     | **200** | 403            |
| `GET /audit-sessions/{id}`                                          | **200** | **200** | **200** (own only) | 403 |
| `GET /audit-sessions` (list, filters)                               | **200** | **200** | 403  | 403               |
| `GET /audit-sessions/{id}/table1/scan-targets`                      | 403     | 403     | **200** (own) | 403   |
| `POST /audit-sessions/{id}/table1/scan`                             | 403     | 403     | **200** (own) | 403   |
| `PATCH /audit-sessions/{id}/table1/rows/{row_id}`                   | 403     | 403     | **200** (own) | 403   |
| `POST /audit-sessions/{id}/table1/submit` / `…/table1/modify`       | 403     | 403     | **200** (own) | 403   |
| `PATCH /audit-sessions/{id}/table2/rows/{row_id}`                   | 403     | 403     | **200** (own) | 403   |
| `POST /audit-sessions/{id}/table2/submit` / `…/table2/modify`       | 403     | 403     | **200** (own) | 403   |
| `POST /audit-sessions/{id}/complete`                                | 403     | 403     | **200** (own) | 403   |
| `POST /audit-sessions/{id}/cancel`                                  | 403     | 403     | **200** (own) | 403   |
| `GET /accessory-stock` (read-only)                                  | **200** | **200** | 403  | 403               |

- The mutating audit routes are gated by `requireAuth + requireAso`; `GET /audit-sessions/{id}` is gated by `requireAuth` alone and uses `loadSessionForActor(..., {allowReaders:true})` so SA/Admin can read any session while an ASO reads only their own.
- The list endpoint is gated by `requireAdminRead` and carries a defense-in-depth inline `user_type_code === 'ASO' → 403` (an ASO can never reach the list; they use `/current`).
- **SA + Admin** cannot start, run, complete, or cancel a session on someone else's behalf. There is no "audit on behalf of user X" route in this slice.
- **ASO** can mutate **only their own session**. The `(own only)` rows return 403 — not 404 — if the path refers to another user's session (`loadSessionForActor` returns `{status:403}` for a non-owner non-reader), so ASO does not even learn that another session exists.
- Assigning / changing an ASO's `location_id` rides on the existing `PUT /locations/{id}/assigned-users` endpoint — that route already gates by SA / Admin (`requireAuth + requireAdmin`), no change to its authorization rules.

### 1.9 Resolved product decisions
- `ASO` user type is activated route-by-route — no global "ASO can read everything" door.
- The 30-minute inactivity rule freezes editing UX (banner) but does not change session status. Auto-suspended sessions remain `Incomplete` and resumable.
- Cancelled PARs are **soft-deleted** (`deleted_at = NOW()`) so the AIN sequence and audit trail are preserved; they do **not** render in any Reports list (consistent with the spec line "It is not visible in Audit Reports also").
- **Table 2 audits ALL accessory Vendor SKUs, vendor-agnostic and status-agnostic.** The earlier "Innoviti-only, Active-only" gate was **reversed** in code: the seed predicate is now only `vendor_skus.deleted_at IS NULL AND sku_types.serial_eligible = FALSE` — every accessory Vendor SKU from **any** vendor, **Active or Inactive**, seeds; only soft-deleted ones are skipped (so a third-party cable still appears). See §4.
- A new `accessory_stock_balances` table is introduced in this slice (§5.2) for each `(vendor_sku, location)` pair. Each row carries: `location_id`, `vendor_sku_id` (with the SKU's snapshot name available via join), `last_audit_session_id` (the most recent Completed audit at this location, which yields the auditor + audit date via join), and the `working_quantity` / `not_working_quantity` counts. Phase 3 ASO only **reads** this table at session start; the Store-review slice writes to it on Completed approval. The Table-2 seed `expected_quantity` is computed as `working_quantity + not_working_quantity` (there is no single `expected_quantity` column on the balances table).
- An ASO's `users.location_id` is the sole source of truth for which location they audit. No parallel join table (`user_audit_locations` is dropped in migration 018), no per-session override — one ASO, one location at any point in time. Reassignment is blocked while an audit is in flight (§1.3, §5.1).

---

## 2. Audit Session

The Audit Session is the top-level Phase 3 object owned by an ASO user. One session = one PAR = one audit visit to the ASO's assigned location (read from `users.location_id`).

### Fields & types
- `audit_session_id` (auto, internal — `SERIAL PRIMARY KEY`).
- `audit_index` (string, `TEXT NOT NULL UNIQUE`, format `AIN-NNNNN` starting at `AIN-10001`, monotonic, **immutable**). Generated via `lib/ids.js::nextIndex('audit', client)`.
- `auditor_user_id` (FK → `users`, **required**, **immutable** after creation). Must be an ASO user.
- `auditor_user_index` (string, snapshot of the ASO's `user_index` at session start — survives later renames/deletes).
- `location_id` (FK → `locations`, **required**, **immutable** after creation). Resolved from `users.location_id` at session start; **snapshotted** so a later reassignment of the user's location does not retroactively change historical PARs.
- `location_snapshot_name` (string, snapshot of the location name at session start, for display in Reports).
- `status` (enum, **required**, default `Incomplete`): one of `Incomplete`, `PendingReview`, `Cancelled`, `Completed`. Phase 3 ASO writes only the first three. `Completed` is reserved for the Store-review task file.
- `table1_state` (enum, default `Editing`): `Editing` or `Submitted`. Toggles via the Table-1 Submit/Modify buttons.
- `table2_state` (enum, default `Editing`): `Editing` or `Submitted`.
- `started_at` (timestamp, default `NOW()` on Insert).
- `last_activity_at` (timestamp, default `NOW()`, bumped on every write).
- `auto_suspended_at` (timestamp, **nullable**; set by the 5-minute sweep when `last_activity_at < NOW() - 30m`; cleared on the next write).
- `completed_at` (timestamp, **nullable**; set when status moves to `PendingReview`).
- `cancelled_at` (timestamp, **nullable**; set when status moves to `Cancelled`).
- `created_at`, `updated_at`, `deleted_at` (timestamps; `deleted_at` is set only on cancel — soft delete is the only retirement mechanism).

**Response shape (`shapeSession`):** every single-session read/mutation endpoint (except the non-idempotent cancel — see below) returns `audit_session_id, audit_index, auditor_user_id, auditor_user_index, auditor_name` (computed as `` `${first} ${last}`.trim() ``), `location_id, location_snapshot_name, status, table1_state, table2_state, started_at, last_activity_at, auto_suspended_at, completed_at, cancelled_at, table1_rows[], table2_rows[]`. The join-only columns loaded by `loadSessionForActor` (`auditor_first_name`, `auditor_last_name`, `current_location_name`, `current_location_index`) are **not** emitted by `shapeSession`. Note the **list** endpoint computes `auditor_name` differently — as `first_name || ' ' || last_name` (SQL concat, **not** trimmed), so a null/empty last name yields a trailing space there.

### Index / uniqueness
- Partial unique index `idx_audit_sessions_one_open` on `(auditor_user_id) WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL` — enforces the one-non-terminal-session-per-user invariant at the DB level.
- Unique index on `audit_index`.
- Plain indexes on `(auditor_user_id)` (`idx_audit_sessions_auditor`), `(location_id)` (`idx_audit_sessions_location`), `(status)` (`idx_audit_sessions_status`), `(started_at)` (`idx_audit_sessions_started`); partial index `idx_audit_sessions_suspend` on `(last_activity_at) WHERE status = 'Incomplete' AND auto_suspended_at IS NULL AND deleted_at IS NULL` (drives the suspension sweep).

### API endpoints
- `POST /audit-sessions` — start (or resume) the calling ASO's session. Body is empty. Server first checks for an existing non-terminal session: if `PendingReview` → 409 `audit_pending_review_block`; if `Incomplete` → returns that existing session (HTTP **200**, both tables expanded). Otherwise it resolves `users.location_id` (else 422 `audit_location_not_assigned`), allocates the AIN, snapshots the location id + joined name into the new row, seeds Table 1 (§3) and Table 2 (§4), writes the Create change-log row, and returns the full session (HTTP **201**). **ASO only.**
  - On a partial-unique-index race (concurrent start), the loser's INSERT raises `23505`; the handler catches it, re-reads, and returns the resume path (HTTP 200).
- `GET /audit-sessions/current` — convenience for the Audit tab landing page. Returns `{ status: 'none' }` when no non-terminal session exists; `{ status: 'PendingReview', audit_index, audit_session_id }` when a PendingReview exists (so the UI can render the block message without a second request); or the full `Incomplete` session (both tables expanded) otherwise. **ASO only.**
- `GET /audit-sessions/{id}` — read one with tables expanded. SA/Admin can read any; ASO can read only their own (cross-user access returns 403, not 404). Gated by `requireAuth` + `loadSessionForActor(..., {allowReaders:true})`.
- `GET /audit-sessions` — list with filters `status`, `auditor_user_id`, `location_id`, `started_at_from`/`_to`. SA/Admin only (`requireAdminRead`, plus an inline ASO 403). Returns a flat list (no child rows), ordered by `started_at DESC`, filtered `deleted_at IS NULL`.
- `POST /audit-sessions/{id}/complete` — transition `Incomplete → PendingReview`, sets `completed_at = NOW()`. Requires both `table1_state = 'Submitted'` AND `table2_state = 'Submitted'`; otherwise HTTP 409 `audit_tables_not_submitted` naming the offending table(s) in `fields.pending`. `Cancelled` → 410 `audit_session_cancelled`; any non-`Incomplete` status → 409 `audit_session_frozen`. **ASO only, own session.**
- `POST /audit-sessions/{id}/cancel` — transition `* → Cancelled` + soft-delete (`cancelled_at = NOW()`, `deleted_at = NOW()`). Idempotent: an already-`Cancelled` session returns 200 via `shapeSession`. A `PendingReview`/`Completed` session → 409 `audit_session_frozen`. **ASO only, own session.**

> NOTE: The non-idempotent cancel branch returns `{...row, ...fresh}` — a spread of a fresh `SELECT *` over the pre-update loaded row — **not** `shapeSession(...)`. So a just-cancelled session's response carries raw column names and no `table1_rows`/`table2_rows`, unlike every other endpoint. Because `row` came from `loadSessionForActor`, this body also leaks the join-only columns `shapeSession` normally suppresses (`auditor_first_name`, `auditor_last_name`, `current_location_name`, `current_location_index`). The idempotent (already-cancelled) branch **does** use `shapeSession`. The UI ignores the cancel body and re-fetches `/current` (re-rendering to the Start view), so this asymmetry is invisible to the ASO but matters to API clients.

### Validation rules
- A session cannot transition `Incomplete → PendingReview` unless both `table1_state` and `table2_state` are `Submitted`.
- A session in any non-`Incomplete`, non-`Cancelled` status (i.e. `PendingReview`/`Completed`) rejects all mutations (scan, scan-targets is read-only and still allowed, row patch, submit, modify, complete) with HTTP 409 `audit_session_frozen`. Only the (future) Store-review path can move it on.
- A session in `Cancelled` rejects all mutations with HTTP 410 `audit_session_cancelled`.
- The ASO's `users.location_id` may be changed (via the location-assignment endpoint) **only when no `Incomplete` or `PendingReview` session exists** for that user — see §5.1.

### Business rules / invariants
- The PAR identity is the session row itself. There is no separate `pars` table — Table 1 and Table 2 row tables (§3, §4) are children of the session.
- The Reports view (defined in the separate Audit-Report task file) filters by `status IN ('Incomplete','PendingReview','Completed') AND deleted_at IS NULL` — Cancelled sessions are excluded.

### UI surface
See §6 for the full screen. The session header shows:
- The eyebrow `Audit · <AIN>` and heading `Provisional Audit Report (PAR) <AIN>`.
- A meta line: **Location:** snapshot name · **Auditor:** auditor name · **Started:** local timestamp.
- The button `Complete Audit Session <AIN>` and `Cancel Audit Session <AIN>` (top of page, in `row-actions`).
- A small inline `role="status"` banner when `auto_suspended_at IS NOT NULL`: `Auto-suspended after 30 minutes of inactivity — resume by scanning or editing below.`

### Acceptance
- An ASO with `users.location_id` set and no non-terminal audit session: `POST /audit-sessions` returns 201 with a fresh AIN, both tables seeded, status `Incomplete`.
- An ASO with `users.location_id = NULL`: `POST /audit-sessions` returns 422 `audit_location_not_assigned`.
- Re-`POST /audit-sessions` with the same ASO (Incomplete in flight) returns the same existing session with HTTP 200 (no duplicate AIN, no extra row, no second change-log Create).
- An ASO with a `PendingReview` session: `POST /audit-sessions` returns 409 `audit_pending_review_block` with the exact spec message including the prior AIN; it is **not** resumed.
- `POST /audit-sessions/{id}/complete` while `table2_state = 'Editing'` returns 409 `audit_tables_not_submitted` naming Table 2 in `fields.pending`.
- `POST /audit-sessions/{id}/cancel` flips status to `Cancelled`, sets `cancelled_at` + `deleted_at`, writes a `SoftDelete` change-log row; subsequent reads via `GET /audit-sessions/{id}` succeed but no scan/submit/modify mutation does (410 `audit_session_cancelled`).
- Two concurrent `POST /audit-sessions` calls for the same ASO produce exactly one new session (the partial unique index prevents the second insert; the second call catches `23505` and falls back to the resume path).

---

## 3. Audit Session — Table 1 (Serial-type rows)

Table 1 holds one row per serial-numbered unit that is either expected at the audit location, scanned during the audit (and found in a Master), or scanned-but-unknown (in no Master).

### Fields & types
- `audit_serial_row_id` (auto, internal).
- `audit_session_id` (FK → `audit_sessions`, **required**, **immutable**).
- `master_kind` (`TEXT`, nullable): `payment_terminal`, `base_station`, `sim_card`, or `NULL`. Identifies which Master table the unit lives in. The CHECK constraint `chk_serial_row_master_kind` permits `master_kind = NULL` **only** when `unregistered_serial_number IS NOT NULL`.

  > NOTE: In current code the scan handler always sets `master_kind` to the chosen scan-target's kind even for **Unregistered** rows (it derives the kind from the SKU the ASO picked). So the "NULL master_kind" branch the constraint allows is permitted but not exercised — an Unregistered row carries a non-null `master_kind` (e.g. `payment_terminal`) with `master_row_id = NULL`.

- `master_row_id` (BIGINT, **nullable**). When `master_kind` resolves to one of the three Master tables and the serial was found there, this holds the corresponding `payment_terminal_master_id` / `base_station_master_id` / `sim_card_master_id`. **Null** for Unregistered rows (the serial wasn't found in any Master).
- `vendor_sku_id_snapshot` (FK → `vendor_skus`, **nullable**) — populated for PT/BS rows (expected, unexpected, and unregistered); **null** for SIM rows.
- `vendor_sku_number_snapshot` (string, snapshot at row creation; null for SIM). **Stored but hidden from the ASO view** (§6).
- `vendor_sku_name_snapshot` (string, snapshot at row creation; null for SIM). This is the only SKU label surfaced to the ASO for PT/BS rows.
- `sku_id_snapshot` (FK → `skus`, **nullable**) — populated for SIM rows (always) and for PT/BS rows when the unit has a resolvable Innoviti SKU (`LEFT JOIN skus`, so null when none); null for PT/BS Unregistered rows.
- `sku_number_snapshot` (string, snapshot, nullable).
- `sku_name_snapshot` (string, snapshot, nullable) — the SKU label surfaced to the ASO for SIM rows.
- `expected_serial_number` (string, **nullable**) — non-null only for **pre-populated expected rows** (units the Master table says should be at this location).
- `unexpected_serial_number` (string, **nullable**) — non-null when an in-Master serial was scanned that wasn't on the expected list.
- `unregistered_serial_number` (string, **nullable**) — non-null when a scanned serial doesn't exist in any Master of the chosen model.
- `matched` (boolean, `NOT NULL DEFAULT FALSE`) — `TRUE` once an expected row is hit by a scan, and `TRUE` on an **Unexpected** row at creation (the serial was found in a Master). **`FALSE` on an Unregistered row** (and `FALSE` on a seeded-but-unscanned expected row).

  > NOTE: "Matched" means *the serial was found in the Master*. An Unregistered serial, by definition, is **not** in any Master, so its row is stored with `matched = FALSE`. (This corrects the earlier spec interpretation that counted Unregistered rows as `matched = true`.) The ASO still sees the row — it surfaces with the `Unregistered` status badge (§6.2), independent of `matched`.

- `missing` (boolean, `NOT NULL DEFAULT FALSE`) — set to `TRUE` on Table-1 Submit where `expected_serial_number IS NOT NULL AND matched = FALSE`. Cleared back to `FALSE` on Modify.
- `remarks` (string, nullable, optional) — auto-populated breadcrumbs on Unexpected rows, ASO-editable via PATCH. **Stored but hidden from the ASO view** (§6 — no Remarks column or input). The auto-inserted phrases, joined by `', '` in this order:
  - `Wrong Location` — set on an Unexpected row whose matched Master `present_location_id` is non-null and is not the session's `location_id` at scan time.
  - `Recovered` — appended when the matched Master row's `state` was `Lost` at scan time.
  - `Multiple master matches; first used.` — appended in the rare data-quality case where the same serial lives under more than one Vendor SKU of the scanned model group.
- `working_status` (enum, `NOT NULL DEFAULT 'Working'`): `Working` or `Not Working`. Default applies to **both** pre-populated and scanned rows.
- `scanned_at` (timestamp, nullable; set `NOW()` when a row is matched-by-scan or created-by-scan; remains null on seeded-but-unscanned expected rows).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Index / uniqueness
- Index on `(audit_session_id)` (`idx_asrr_session`).
- Index on `(audit_session_id, expected_serial_number)` (`idx_asrr_expected`) for the duplicate-scan / expected-match checks.
- Index on `(audit_session_id, unexpected_serial_number)` (`idx_asrr_unexpected`).
- Index on `(audit_session_id, unregistered_serial_number)` (`idx_asrr_unregistered`).
- **No global unique index** on serial across sessions, and **none** on `master_row_id` — different sessions can legitimately scan the same serial (e.g., the second audit after a unit moves).
- The duplicate-scan guard at scan time enforces "this serial does not already count for this model in this session" (see scan step 1).
- `fetchTable1Rows` returns rows ordered category (expected=0 / unexpected=1 / unregistered=2), then `scanned_at NULLS FIRST`, then `audit_serial_row_id`. The ASO UI ignores this and re-sorts client-side (by SKU name → status rank → serial; §6.2), so the server order only matters to API clients.

### Pre-population at session start
On `POST /audit-sessions`, the server seeds Table 1 with one row per expected unit, inside the create transaction, via three INSERT…SELECT statements (PT, BS, SIM):

- **Source predicate (state filter)** — each Master row at this location in an **expected state**. The expected states are explicit **inclusion** allow-lists, not a `NOT IN (...)` exclusion:
  - PT / BS: `state = ANY(EXPECTED_PT_BS_STATES)` where `EXPECTED_PT_BS_STATES = ['Working', 'Retrieved Not Inspected', 'Installed', 'Under Repair', 'Repaired Not Inspected', 'In Transit']`.
  - SIM: `state = ANY(EXPECTED_SIM_STATES)` where `EXPECTED_SIM_STATES = ['Active', 'Inactive', 'Blocked']`.

  > NOTE: The spec just says "expected with the user carrying out the audit." We interpret this as `present_location_id = ASO's home location (users.location_id)` in one of the inclusion states above. Terminal/unexpected states (e.g. `Scrap`, `Loss`/`Lost`) are excluded by simply not appearing in the allow-list — a `Lost` serial subsequently scanned becomes an Unexpected row with remark `Recovered`, exactly per the spec.

- **Vendor-SKU activeness gate (PT / BS)**: the seed `INNER JOIN`s `vendor_skus vs ON vs.vendor_sku_id = m.vendor_sku_id AND vs.deleted_at IS NULL AND vs.status = 'Active'`, keyed on the **unit's own `m.vendor_sku_id`** (the anchor key, not the Innoviti SKU's default-supplier link). So a PT/BS whose `vendor_sku_id` is NULL or points to an Inactive/deleted Vendor SKU does **not** seed. The Innoviti SKU is joined `LEFT` (`sku_id` is nullable on PT/BS since migration 009), so `sku_*_snapshot` are null when the unit has no resolved SKU.
- **SKU activeness gate (SIM)**: SIM Master has no usable `vendor_sku_id` (NULL in practice), so the gate is on the **Innoviti SKU** — `INNER JOIN skus s ON s.sku_id = m.sku_id AND s.status = 'Active' AND s.deleted_at IS NULL`. A SIM with no Active SKU does not seed. Only `sku_*_snapshot` are written; `vendor_sku_*_snapshot` stay null. `expected_serial_number = m.sim_card_number`.

  > NOTE: This is the **PT/BS-vs-SIM anchor asymmetry** the SKU schema map (`docs/sku_schema.md`) calls out: PT/BS gate and match on `vendor_sku_id`; SIM gates and matches on `sku_id`. The two serial-eligible families use different activeness sources by design — see §5.3.

- Row population: each seeded row carries `expected_serial_number = master.serial_number / sim_card_number`, with DDL defaults `matched = FALSE`, `missing = FALSE`, `working_status = 'Working'`, `scanned_at = NULL`; all `_snapshot` fields filled from the master + the joined `vendor_sku` (PT/BS) or `sku` (SIM).
- All seeding happens **inside the session-creation transaction**. Seeding failure rolls back the session.

### Scan-target picker — `GET /audit-sessions/{id}/table1/scan-targets`

A serial is unique only **within** a Vendor SKU (migration 009: `UNIQUE(vendor_sku_id, serial_number)` on PT/BS), so a bare serial is ambiguous — the ASO must pick a SKU first. This endpoint returns `{ targets: [...] }`, the picker list the UI loads once per session, vendor-agnostic:

- **Vendor-SKU groups** (`kind:'vendor_sku'`): every Active, non-deleted, serial-eligible, non-SIM Vendor SKU, grouped by display label so a model carried by two vendors shows **once**:
  ```sql
  SELECT COALESCE(NULLIF(TRIM(vs.vendor_sku_name),''), vs.vendor_sku_number) AS label,
         st.name AS type_name,
         array_agg(vs.vendor_sku_id ORDER BY vs.vendor_sku_id) AS vendor_sku_ids
    FROM vendor_skus vs JOIN sku_types st ON st.sku_type_id = vs.sku_type_id
   WHERE vs.status = 'Active' AND vs.deleted_at IS NULL
     AND st.serial_eligible = TRUE AND st.name <> 'SIM Card'
   GROUP BY label, st.name ORDER BY label
  ```
  Each target: `{ kind:'vendor_sku', label, type_name, vendor_sku_ids:[...] }`.
- **SIM SKUs** (`kind:'sim_sku'`): every Active, non-deleted SKU of type `SIM Card`, label `COALESCE(NULLIF(TRIM(sku_name),''), sku_number)` → `{ kind:'sim_sku', label, type_name, sku_id }`.

The picker spans **all** active serial-type SKUs (not just those expected at this location), so Unexpected / Unregistered scans for any model are recordable.

> NOTE: The scan picker (and `resolveScanTarget`) is **Active-only** — `vendor_skus.status = 'Active'` for PT/BS, `skus.status = 'Active'` for SIM. This is asymmetric with **Table 2 seeding**, which is status-agnostic (Active **or** Inactive — see §4). The two tables apply activeness differently on purpose; do not conflate them.

### Scan handling — `POST /audit-sessions/{id}/table1/scan`

Request body: `{ "serial_number": "<scanned value>", "vendor_sku_ids": [int,...] | "sku_id": int }` — exactly one of `vendor_sku_ids` / `sku_id` selects the model.

Server-side algorithm (single transaction):

1. **Permission / state gate** (before the transaction): 403/404 via `loadSessionForActor`; 410 `audit_session_cancelled` if `status = 'Cancelled'`; 409 `audit_session_frozen` if `status != 'Incomplete'`; 409 `table1_frozen` if `table1_state != 'Editing'`.
2. **Serial normalize**: `raw.trim().replace(/\s+/g,' ')`; blank → 422 `required_missing`; `> 100` chars → 422 `bad_format`.
3. **Resolve target** (`resolveScanTarget`): XOR-validate the SKU selection. If both or neither of `vendor_sku_ids`/`sku_id` are supplied → 422 `required_missing` ("Select a SKU before entering a serial number."). For the vendor path, coerce to positive ints and validate against `vendor_sku_id = ANY(...) AND deleted_at IS NULL AND status='Active' AND serial_eligible=TRUE AND name <> 'SIM Card'` → no rows means 422 `bad_format`. Returns a normalized target: `match_col` (`vendor_sku_id_snapshot` for the group, `sku_id_snapshot` for SIM), `match_vals` (all vendor_sku_ids in the group, or the one sku_id), `master_kind` (`base_station` only when the type is exactly `Base Station`, else `payment_terminal`; `sim_card` for SIM), plus a **representative** Vendor SKU (`rep_vendor_sku_id/number/name`) for the Unregistered snapshot, or the SIM SKU fields.
4. **Duplicate guard** — scoped to the model's key set:
   ```sql
   WHERE audit_session_id = $1 AND deleted_at IS NULL
     AND <match_col> = ANY($3::int[])
     AND ( (expected_serial_number = $2 AND matched = TRUE)
           OR unexpected_serial_number = $2
           OR unregistered_serial_number = $2 )
   ```
   Any hit → 409 `duplicate_scan` with the exact spec message `"<S.No.> has already been audited in this session."` (fields `{serial_number}`).

   > NOTE: An *unmatched* expected row with the same serial is **not** a duplicate — the `matched = TRUE` qualifier on the expected branch is what lets the real scan flip it. Only an already-counted serial (matched expected, or an existing unexpected/unregistered) blocks.
5. **Expected match path**: flip the single lowest-id unmatched expected row for this model whose `expected_serial_number = serial AND <match_col> = ANY(match_vals) AND matched = FALSE` → `SET matched = TRUE, scanned_at = NOW()`. On hit, `logChange('AuditSerialRow', row_id, actor, 'Update')`, `bumpActivity`, return the row. No new row, no remarks change.
6. **Master search path (Unexpected)**: `findInMasterForTarget` searches the chosen Master table (PT/BS by `vendor_sku_id = ANY(match_vals) AND serial_number = serial`, scanning the whole group so the hit reveals the **actual** vendor; SIM by `sku_id AND sim_card_number`). On a hit, INSERT a new row with `unexpected_serial_number = serial`, `matched = TRUE`, `master_row_id = hit`, `master_kind = target.master_kind`. For PT/BS the `vendor_sku_*_snapshot` are taken from the **matched Master row** (vendor recovery); `sku_*` from the hit. For SIM, `vendor_sku_* = NULL`, `sku_* = target.sku_*`. Reserved remarks (joined `', '`, null if empty): `Wrong Location` (if `present_location_id` set and ≠ session location), then `Recovered` (if `state = 'Lost'`), then `Multiple master matches; first used.` (if more than one match in the group). `logChange(..., 'Create')`, `bumpActivity`, return the row.
7. **Unregistered path**: if no Master match, INSERT a new row with `unregistered_serial_number = serial`, **`matched = FALSE`**, `master_kind = target.master_kind`, `master_row_id` omitted/NULL. Snapshots are the **chosen representative model** (vendor-agnostic): PT/BS → `rep_vendor_sku_id/number/name`, `sku_* = NULL`; SIM → `vendor_sku_* = NULL`, `sku_* = target.sku_*`. `logChange(..., 'Create')`, `bumpActivity`, return the row.

**matched-flag summary:**

| Outcome | `matched` |
|---|---|
| Expected hit (step 5) | `TRUE` (flipped on the seeded row) |
| Unexpected (step 6) | `TRUE` |
| Unregistered (step 7) | **`FALSE`** |

### Row update — `PATCH /audit-sessions/{id}/table1/rows/{row_id}`

Whitelisted updatable fields: `working_status` (`Working`|`Not Working`) and `remarks` (free text).

- `working_status` is allowed only while `status = 'Incomplete'` AND `table1_state = 'Editing'`; otherwise 410 `audit_session_cancelled` / 409 `audit_session_frozen` / 409 `table1_frozen`. A value outside `{Working, Not Working}` → 422 `bad_format`. Written only if different from the current value.
- `remarks`: `null` clears the field (only when currently non-null). A string is sanitized `r.replace(/[\r\n]+/g,' ').replace(/^\s+/,'')`; `> 500` chars → 422 `bad_format`; non-string → 422 `bad_format`. Written only if changed.

  > NOTE: A `remarks` PATCH **overwrites the whole field** — it does not preserve or prepend the auto-inserted reserved phrases (`Wrong Location` / `Recovered` / `Multiple master matches; first used.`). The ASO view does not render remarks at all (§6), so this field is effectively API/Store-review surface only.

- A no-op PATCH (no field actually changed) returns the unchanged target with **no** `logChange` and **no** `bumpActivity`. An effective change runs in one transaction: the `UPDATE`, then `logChange('AuditSerialRow', row_id, actor, 'Update')`, then `bumpActivity`.

### Table-1 Submit / Modify

- `POST /audit-sessions/{id}/table1/submit` — transition `table1_state: Editing → Submitted` (idempotent — already-`Submitted` returns the shaped session, no writes). Before flipping, sets the Missing flags: `UPDATE audit_session_serial_rows SET missing = TRUE WHERE audit_session_id = $1 AND expected_serial_number IS NOT NULL AND matched = FALSE AND deleted_at IS NULL`. Bumps activity, writes one change-log row `(AuditSession, AIN, actor, Update)`.
- `POST /audit-sessions/{id}/table1/modify` — transition `table1_state: Submitted → Editing` (idempotent). Clears Missing flags: `UPDATE … SET missing = FALSE WHERE audit_session_id = $1 AND missing = TRUE AND deleted_at IS NULL`. Bumps activity, writes one change-log row `(AuditSession, AIN, actor, Update)`.

### Validation rules
- Scan serial must be non-blank and ≤ 100 chars after trimming/whitespace-collapse (else 422 `required_missing` / `bad_format`).
- A `working_status` value outside `{Working, Not Working}` returns 422 `bad_format`.
- `remarks` is optional; `null` is a valid value (clears).

### Business rules / invariants
- A row's category is **exactly one** of expected / unexpected / unregistered — enforced by `chk_serial_row_category` (the three `_serial_number` columns sum to exactly 1 non-null).
- `master_row_id` is null on Unregistered rows; `master_kind` is **set** (to the chosen model's kind) even on Unregistered rows in current code (the constraint only *permits* NULL there).
- Soft delete is **not used** for individual Table-1 rows in this slice. A mistaken scan cannot be retracted via DELETE — the Modify button is the rollback mechanism (re-open the table, fix, re-submit).

### UI surface
See §6.2 — the Table-1 panel renders as **two sub-tables** (Summary + Serial detail).

### Acceptance
- Session creation at a location with 12 PT units (Active Vendor SKU, expected state), 4 BS units, 25 SIM cards (Active Innoviti SKU, expected state) seeds 41 expected rows with `matched=false`, `missing=false`, `working_status='Working'`, `scanned_at` null.
- Scanning a serial that matches one of those 41 (with the matching model selected) → that row flips `matched=true`, `scanned_at` set; no new row; change-log `Update`.
- Scanning a serial that is in PT Master at a different location → new Unexpected row, `matched=true`, `remarks = 'Wrong Location'`.
- Scanning a serial whose Master state is `Lost` → new Unexpected row, `remarks = 'Recovered'` (or `Wrong Location, Recovered` if both apply).
- Scanning a serial that is in **no** Master of the selected model → new **Unregistered** row with **`matched = false`**, `master_kind` = the selected model's kind, `master_row_id = NULL`, representative-model snapshots populated.
- Scanning the same serial twice for the same model in one session: second scan returns 409 `duplicate_scan` with the serial in the message.
- After Submit, any expected row with `matched=false` has `missing=true`. After Modify, all `missing` flags are false again.
- Patching `working_status` to `Not Working` succeeds while `Editing`, returns 409 `table1_frozen` while `Submitted`.

---

## 4. Audit Session — Table 2 (Accessory rows)

Table 2 holds one row per **accessory Vendor SKU** (any vendor, any status), with counters the ASO increments.

### Fields & types
- `audit_accessory_row_id` (auto, internal).
- `audit_session_id` (FK → `audit_sessions`, **required**, **immutable**).
- `vendor_sku_id` (FK → `vendor_skus`, **required**, **immutable**).
- `vendor_sku_number_snapshot` (string, `NOT NULL`). **Stored but hidden from the ASO view** (§6.3).
- `vendor_sku_name_snapshot` (string, nullable) — the only SKU label surfaced to the ASO.
- `expected_quantity` (integer ≥ 0, `NOT NULL DEFAULT 0`, **snapshot at seed time**). Computed as `COALESCE(asb.working_quantity,0) + COALESCE(asb.not_working_quantity,0)` from `accessory_stock_balances` (so it is the **sum** of the two balance columns, 0 when no balance row exists). No 10000 cap on this seeded value.
- `working_count` (integer, `NOT NULL DEFAULT 0`, CHECK 0–10000).
- `not_working_count` (integer, `NOT NULL DEFAULT 0`, CHECK 0–10000).
- `missing_count` (integer, **nullable**, CHECK `NULL OR ≥ 0`; computed on Submit, cleared to NULL on Modify). Formula: `GREATEST(expected_quantity - working_count - not_working_count, 0)`.

  > NOTE: The spec says "the difference between Expected Item Count and Working + Not Working is shown under Missing Count" — taken literally that's `expected - working - not_working`, which can be negative if the ASO finds more than expected. We clamp at 0 (`GREATEST(...,0)`) because "Missing: -3" is meaningless (a negative is really "found extras," out of scope here). Override if product wants the literal signed value.

- `created_at`, `updated_at` (timestamps). **No `deleted_at`** — Table-2 rows live with the session and are not retractable individually.

> NOTE: In addition to the stored columns above, every Table-2 row object in an API response (`fetchTable2Rows`) also carries three **live-joined** columns from `vendor_skus`: `vendor_sku_number`, `vendor_sku_name`, and `vendor_sku_status`. `shapeSession` passes these straight through in `table2_rows[]`, so the API exposes the **current** vendor-SKU number/name/status (e.g. a SKU that has since gone Inactive) even though only the `_snapshot` columns are persisted on the row. Rows are also ordered by the live `vs.vendor_sku_number`, not the snapshot.

### Index / uniqueness
- Unique `(audit_session_id, vendor_sku_id)` (`idx_asar_session_vendor_sku`) — one row per vendor SKU per session.
- Plain index on `(audit_session_id)`.

### Pre-population at session start
On `POST /audit-sessions`, the server seeds Table 2 with one row per accessory Vendor SKU:

- **Source predicate**: every Vendor SKU with `vendor_skus.deleted_at IS NULL AND sku_types.serial_eligible = FALSE`. There is **no** vendor (Innoviti) gate and **no** `status` gate — every accessory Vendor SKU from **any** vendor, **Active or Inactive**, seeds; only soft-deleted ones are skipped. Joined via `sku_types` (Vendor SKUs carry `sku_type_id` since migration 013).

  > NOTE: This reverses the earlier "Innoviti-only, Active-only" decision (recorded in the in-code comment: "the original Innoviti-vendor + Active-only gate was too narrow; a cable from a third-party vendor must still appear in Table 2"). See §1.9 and Open Question #2.

- **Expected quantity source**: a LEFT JOIN to `accessory_stock_balances` keyed on `(vendor_sku_id, location_id = session.location_id)`. `expected_quantity = COALESCE(working_quantity,0) + COALESCE(not_working_quantity,0)` → **0 when no balance row exists**.
- Seeded counts: `working_count = 0`, `not_working_count = 0`, `missing_count = NULL`. Rows ordered by `vendor_sku_number`.

### Counter update — `PATCH /audit-sessions/{id}/table2/rows/{row_id}`

Request body: `{ "working_count"?: int, "not_working_count"?: int }`. Both optional; PATCH semantics — only supplied fields are updated.

- Each supplied value must be a finite integer with `0 ≤ n ≤ 10000` (`ROW_LIMIT_PER_COUNTER`); otherwise 422 `bad_format` (`Value '<v>' for '<field>' is not a valid non-negative integer (≤10000).`).
- Allowed only while `status = 'Incomplete'` AND `table2_state = 'Editing'`; otherwise 410 `audit_session_cancelled` / 409 `audit_session_frozen` / 409 `table2_frozen`.
- A no-op PATCH (no field actually changed) returns the target with **no** `logChange` and **no** `bumpActivity`. An effective change runs in one transaction: `UPDATE`, then `logChange('AuditAccessoryRow', row_id, actor, 'Update')`, then `bumpActivity`.

The UI's `−` / `+` buttons are syntactic sugar over this PATCH — they send the **new absolute value** (current ± 1), not a delta. This avoids drift if two clicks race on flaky network.

### Table-2 Submit / Modify

- `POST /audit-sessions/{id}/table2/submit` — transition `table2_state: Editing → Submitted` (idempotent). For every row: `missing_count = GREATEST(expected_quantity - working_count - not_working_count, 0)`. Writes one change-log `(AuditSession, AIN, actor, Update)`.
- `POST /audit-sessions/{id}/table2/modify` — transition `table2_state: Submitted → Editing` (idempotent). Sets every row's `missing_count = NULL`. Writes one change-log row.

### Validation rules
- Counters must be non-negative integers ≤ 10000.
- A row whose seeded `vendor_sku` later becomes Inactive *during the session* is **kept** in the table (snapshot semantics). The table doesn't re-seed on every read. (And because the seed is status-agnostic, an Inactive accessory Vendor SKU is seeded in the first place.)

### Business rules / invariants
- A Table-2 row whose `working_count + not_working_count > expected_quantity` is allowed; `missing_count` is clamped to 0. The "extra" is not separately reported in this slice — capturing surplus is out of scope for ASO.
- A seeded `expected_quantity` greater than 10000 (the balance can exceed the per-counter cap) can never be fully matched by the counters; the shortfall simply surfaces as `missing_count`.
- All Phase-3 ASO writes to `accessory_stock_balances` happen **only when the Store user later approves a PendingReview audit** (separate task file). The ASO slice never mutates that table. It only **reads** it (LEFT JOIN) during seeding.

### UI surface
See §6.3 — the Table-2 panel.

### Acceptance
- Session at a location seeds one Table-2 row for **every** non-deleted accessory Vendor SKU (any vendor, Active or Inactive).
- A vendor SKU with no `accessory_stock_balances` row at this location seeds with `expected_quantity = 0`, rendered as "0" in the UI.
- Counters start at 0; PATCH to `{working_count: 5}` returns 200 with the updated row; the change-log gets a single `Update` row (a repeat PATCH of `5` writes none).
- Submit computes `missing_count = GREATEST(expected - working - not_working, 0)`.
- Modify clears all `missing_count` to null.
- A `working_count` of `-1` (or `> 10000`) returns 422 `bad_format`.

---

## 5. Supporting objects

### 5.1 In-flight-audit guard on the existing location-assignment endpoint

This is **not** a new object and not a schema change. The `users.location_id` column already exists (migration 017; `task1.md` §3), and the only writer of that column is the Phase 1 assignment endpoint (`PUT /locations/{id}/assigned-users`, `routes/locations.js`). What Phase 3 adds is a single **inline in-flight-audit check** in that handler's body (`locations.js` lines 283–302) — there is no hook registry, no boot-time registration, and no decoupling layer; the existing handler was edited directly to add the query.

#### Behavior
- The check runs **after** the existing Phase 1 per-user validation — which is: user exists & is active (else 422 `user_not_found`), user is **not an admin** (else 422 `cannot_assign_admin`), and the user's vendor **matches the location's vendor** (else 422 `user_vendor_mismatch`). There is no Innoviti-specific gate and no ASO-type gate; any non-admin user of the location's vendor can be assigned.
- The handler computes the **affected set**: every **non-admin** user whose `location_id` would change — removals (currently here, dropped from the new list) plus additions/reassignments (in the new list, not already pointing here).
- For that affected set it runs **one** query against `audit_sessions` (`auditor_user_id = ANY(affected) AND status IN ('Incomplete','PendingReview') AND deleted_at IS NULL`) with `LIMIT 1`.
- If any such user is found, the entire `PUT` short-circuits **before the transaction** with HTTP 409 `audit_location_in_use`, naming the **first** offending user + AIN in the error envelope; no users are reassigned.
- If no offending user is found, the request proceeds into the transaction (set/clear `location_id`, write the per-user change-log rows).

#### Change-log
- The `assigned-users` handler emits one `(User, <user_index>, actor, Update)` change-log row **per affected user**, inside its own transaction (`locations.js` lines 312–318). Phase 3 adds no extra change-log row for the location field — but this emission is the handler's own, not something Phase 3 "rides on."

#### Acceptance
- Adding a user who has no non-terminal session: returns 200 (Phase 1 behavior preserved).
- Same call adding (or removing, or reassigning) a user with an `Incomplete` **or** `PendingReview` session: returns 409 `audit_location_in_use`, with `{ user_id, user_index, audit_index }` in the error fields; **no** users in the call get reassigned (the check short-circuits before any write).
- Same call where several listed users would be blocked: the call short-circuits on the **first** match (the guard query is `LIMIT 1`), so the envelope names one offending user at a time; the operator resolves them across repeated calls.
- Same call where every listed user's only `audit_sessions` rows are `Cancelled` or `Completed`: returns 200 (only non-terminal statuses block).
- `POST /audit-sessions` for an ASO whose `users.location_id IS NULL`: returns 422 `audit_location_not_assigned`.

### 5.2 `accessory_stock_balances`

Minimal quantity tracker introduced solely to support Table 2 of the Audit. **Not** a full Accessory Master (Phase 2 deferred that).

#### Fields & types
- `accessory_stock_balance_id` (auto, internal).
- `vendor_sku_id` (FK → `vendor_skus`, **required**) — the accessory. The SKU's snapshot `vendor_sku_name` / number are available via join, not duplicated here.
- `location_id` (FK → `locations`, **required**) — the location whose balance this row tracks.
- `working_quantity` (integer, `NOT NULL DEFAULT 0`, CHECK ≥ 0) — the most recently approved working-count.
- `not_working_quantity` (integer, `NOT NULL DEFAULT 0`, CHECK ≥ 0) — the most recently approved not-working-count.
- `last_audit_session_id` (FK → `audit_sessions`, nullable) — the audit whose Completed approval last wrote this balance. The auditor (`auditor_user_id`, `auditor_user_index`) and audit date (`completed_at`) are reachable via join — no duplication on this row.
- `last_updated_at` (timestamp, nullable, no default) — written by the Store-review slice on approval; the ASO slice never reads or writes it. (No code here establishes a relationship to the session's `completed_at` — that is a Store-review contract, not asserted by this slice.)
- `created_at`, `updated_at` (timestamps).

#### Index / uniqueness
- Unique `(vendor_sku_id, location_id)` (`idx_asb_vsku_loc`).

#### API endpoints
- `GET /accessory-stock?location_id=…&vendor_sku_id=…` — read. **SA/Admin only** (`requireAuth + requireAdminRead`; ASO is 403). Response joins `vendor_skus`, `vendors`, and `locations`, so it includes `vendor_sku_number`, `vendor_sku_name`, `vendor_id`, `vendor_name`, `location_index`, and `location_name`, ordered by `location_name, vendor_sku_number`.
- **No write endpoint in the Phase 3 ASO slice.** Writes happen exclusively in the Store-review task file (when a PendingReview audit is approved, its Table-2 counters become the new balance).

#### Business rules / invariants
- Table-2 of an ASO session **reads** this table (LEFT JOIN) at seed time, summing `working_quantity + not_working_quantity` into `expected_quantity`. It never writes.
- If the row is missing for a given `(vendor_sku_id, location_id)` pair, the audit seeds Table-2 with `expected_quantity = 0` — a perfectly valid first-audit state.

#### Acceptance
- A read against an empty table returns an empty list; no error.
- ASO routes never insert or update rows in this table; an ASO calling `GET /accessory-stock` gets 403.

### 5.3 SKU-world anchor asymmetry (cross-cutting)

The three physical-unit Master tables anchor to the SKU world **differently**, and the audit scan/seed logic is built around this asymmetry. The actual uniqueness constraints live in the **Master-table migrations** (PT/BS `(vendor_sku_id, serial_number)` in `009_stock_vendor_sku.sql`; SIM `(sku_id, sim_card_number)` in `002`), **not** in `014_phase3_aso.sql`; `014` only creates the four audit tables. `docs/sku_schema.md` documents this in full.

- **`payment_terminal_master` / `base_station_master`**: `vendor_sku_id` is the **anchor** key (NOT NULL in practice). `UNIQUE(vendor_sku_id, serial_number) WHERE deleted_at IS NULL` (`idx_ptm_vsku_serial` / `idx_bsm_vsku_serial`) — a serial is unique only **within** a Vendor SKU, so the same serial string can legitimately exist under two different Vendor SKUs (even the same model from two vendors). `sku_id` (the Innoviti SKU) was made **nullable** in migration 009 — it is derived, not owned.
- **`sim_card_master`**: the `vendor_sku_id` column exists (added for uniform shape in 009) but is **NULL on every live row** (009 back-fills PT/BS only — SIMs have no `owner_vendor_id` to back-fill against). `sku_id` stays **NOT NULL**; the canonical key is `UNIQUE(sku_id, sim_card_number)`, defined back in **migration 002** (not 009 — 009 only adds the nullable `vendor_sku_id` column and the non-unique join index `idx_scm_vendor_sku` on `(vendor_sku_id)`).

**Consequence in the audit slice:** PT/BS are picked by a **set of `vendor_sku_id`s** (grouped by display name, vendor-agnostic; `match_col = 'vendor_sku_id_snapshot'`) and matched via `UNIQUE(vendor_sku_id, serial)`. SIM is picked by **`sku_id`** (`match_col = 'sku_id_snapshot'`) and matched via `(sku_id, sim_card_number)`. Table-1 seeding mirrors this: PT/BS gate on `vendor_skus.status = 'Active'`; SIM gates on `skus.status = 'Active'` (its `vendor_sku_id` is NULL). See §3.

### 5.4 Vendor SKU number ↔ name binding (cross-cutting dependency)

Table 1's vendor-agnostic grouping (one picker entry per model name; the `array_agg`-by-label query) and its per-SKU colour coding rely on a model **name** being a stable group key across vendors. This is upheld globally by `vendorSkus.js::assertNameBinding`, which enforces **one name per Vendor SKU number across all vendors** on create / update / restore (a `ValidationError` → 422 otherwise). Without that binding, two vendors could attach different names to the same number and the grouping would split or collide. It is a vendor-SKU-catalogue invariant the audit slice depends on but does not own.

---

## 6. UI surface — Audit screen

### 6.1 Page layout & routing
- **New top-level nav entry**: `Audit`. The sidebar is a static per-`user_type_code` `NAV` map (`Layout.jsx`); the `ASO` key carries the single `{ to:'/audit', label:'Audit' }` link, so only ASO renders a clickable Audit entry. SA and other operational types render no `Audit` item at all; **Admin** renders an `{ section:'Audit' }` divider header (a non-clickable label) under which sits Change Log — i.e. the word "Audit" appears in the Admin sidebar as a section heading, but there is no audit **link** for Admin.
- Path: `/audit` (single route; mirrors the `/load-stock` single-route pattern from Phase 2 §5). The route is wrapped in `<RoleGate allow={['ASO']}>` (`main.jsx`), so a non-ASO who types `/audit` is bounced via `HomeRedirect` independent of the nav; and `HomeRedirect` sends an ASO landing at `/` straight to `/audit`. Enforcement is therefore two-layer (nav + route guard), backed by the backend `requireAso` gates (§1.8).
- The page subscribes to `GET /audit-sessions/current` on mount (`refresh()`), branching on `current.status` in this order:
  1. **Loading** → page-header `Audit` / `<h1>Audit</h1>` + a card with `Loading…`.
  2. `{ status: 'PendingReview', audit_index }` → render the **block message** verbatim in a bold paragraph: `Previous audit <AIN> is awaiting Store review. Cannot start a new audit by the same user until the previous audit review is closed.` No Start button. No tables.
  3. `!current || { status: 'none' }` → render `<StartView>`.
  4. Full `Incomplete` payload (default else) → render `<SessionView>` (sections 6.2 + 6.3) with Complete + Cancel at the top.

- **StartView** (state `none`): page-header eyebrow `Audit`, `<h1>Audit</h1>`, meta `Start a new audit session at your assigned location.` A single `primary` button: `Start Audit Session — <First Last>` (label `Starting…` while busy; falls back to `You` when the name is empty). Clicking `POST /audit-sessions`, toasts `Audit <AIN> started`, and renders the active PAR.

  > NOTE: The button label has **no AIN** (the AIN doesn't exist until the session is created). The post-start header carries the real AIN. If the API responds 422 `audit_location_not_assigned`, the button is replaced by the API's `error-text` message; any other error is a toast only.

- The auto-suspended banner (a `card` with `role="status" aria-live="polite"`, light-amber background) shows when `auto_suspended_at` is truthy: `Auto-suspended after 30 minutes of inactivity — resume by scanning or editing below.`

### 6.2 Table 1 panel

- Heading: `<h2>Table 1 · Serial Items</h2>`; meta `Scan or punch in the S.No. of any Payment Terminal, Base Station, or SIM Card.` When frozen, a `table-status` note: `Submitted — read-only. Use "Modify Table 1" below to edit.`
- **Scan bar** (a `filter-bar` form), control order left → right:
  1. `<select>` SKU picker — first option `Select SKU…` (value `""`); each option label is `<model name> · <type_name>` (model + type, **never the vendor**); option value is the stringified index into the loaded `targets`. `disabled` when frozen.
  2. `<input type="text">` serial entry — placeholder `Scan or type a serial number`; `disabled={isFrozen || !selected}` (disabled when frozen or until a SKU is selected; it is **not** disabled while `busy` — only the `+ Add` and `📷` buttons are); `enterKeyHint="send"`, `inputMode="text"`, `autoComplete="off"`, font ≥ 16px.
  3. `<button type="submit">` `+ Add` (`…` while busy) — disabled until a SKU is selected and the serial input is non-blank. Title `Add this serial to the table below`.
  4. `<button type="button">` `📷 Scan barcode` — opens the camera scanner; disabled while frozen/busy or until a SKU is selected (does **not** require a serial value).
- The picker list is loaded once per session via `GET …/table1/scan-targets`. `+ Add` (or Enter in the input) and a detected barcode both funnel through one `addSerial(value)` path: it maps the selected target to the scan body (`{ vendor_sku_ids:[...] }` for a vendor group, `{ sku_id }` for SIM; null → toast `Select a SKU before entering a serial.`), POSTs `…/table1/scan`, then **re-fetches** `GET /audit-sessions/{id}` and re-focuses the input (model stays selected for back-to-back scans). On error the bad value is kept in the input for correction. This path is **not** optimistic and **not** silent — it round-trips a scan POST plus a session GET so the buckets recompute server-side.
- **Per-SKU accent colouring**: every distinct SKU name (`vendor_sku_name_snapshot`, or `sku_name_snapshot` for SIM rows, else `—`) gets a stable accent cycled through a 10-colour palette, rendered as a left-border bar + a `.sku-dot` swatch in both sub-tables, so a model's rows group visually no matter where they sit.

Table 1 renders as **two sub-tables**:

**Summary sub-table** — `<h3>Summary · counts by SKU</h3>`. One row per SKU name (sorted by name). Columns and sources:

| Column        | Source                                                                 |
|---------------|-----------------------------------------------------------------------|
| SKU Name      | `vendor_sku_name_snapshot` (or `sku_name_snapshot` for SIM; `—` if none) + colour dot |
| Expected      | count of rows with `expected_serial_number != null`                   |
| Matched       | count of expected rows with `matched = true`                          |
| Missing       | count of expected rows with `missing = true`                          |
| Unexpected    | count of rows with `unexpected_serial_number != null`                 |
| Unregistered  | count of rows with `unregistered_serial_number != null`               |

Empty state (`colSpan=6`): `No serial-type items at this location yet. Scan a serial to add it.` Each count cell carries `is-zero` styling when 0 (Expected always renders solid).

**Serial-detail sub-table** — `<h3>Scanned items · serial detail</h3>`. One row per Table-1 row, sorted by SKU name, then status rank `{Matched:0, Unexpected:1, Unregistered:2, Expected:3, Missing:4}`, then serial. Columns and sources:

| Column                | Source                                                                                  |
|-----------------------|-----------------------------------------------------------------------------------------|
| SKU Name              | as above + colour dot                                                                    |
| Serial No.            | `expected_serial_number ?? unexpected_serial_number ?? unregistered_serial_number`       |
| Status                | a status badge derived from the row (see below)                                          |
| Working / Not Working | `working_status` pill toggle — only when `scanned_at` is set; otherwise `—`              |

- **Status** collapses the three serial columns + `matched`/`missing` into one of five buckets: `expected` row → `Matched` (if `matched`), else `Missing` (if `missing`), else `Expected`; `unexpected` row → `Unexpected`; `unregistered` row → `Unregistered`. Badge colours: `Matched → active` (green), `Missing → inactive` (red), `Unexpected → warn` (orange), `Unregistered → purple`, `Expected → plain` (neutral).
- **Working / Not Working**: for a row with `scanned_at`, a pill button (`pill active` when `Working`, `pill` when `Not Working`) toggling between the two; disabled (title `Re-open table to change`) when the table is frozen. An expected-but-unscanned row (no `scanned_at`) renders `—`, not a toggle.
- The working pill toggle is **optimistic + silent**: local state flips immediately, then `PATCH …/table1/rows/{rowId}` fires with `{ silent: true }` (no global loader, no refetch — only this row changed); on failure the pill reverts and a toast surfaces. The optimistic apply clears `auto_suspended_at` locally **only on the forward flip** (`auto_suspended_at: ws === next ? null : <unchanged>`); on the revert path it leaves the prior `auto_suspended_at` untouched — unlike the Table-2 counter (§6.3), which clears it unconditionally. (The server re-asserts the real value on the next `/current` fetch either way.)

> NOTE: The scan-bar `+ Add` (submit one serial) and the bottom `Submit Table 1` (freeze the whole table) are distinct actions — `+ Add` is the inline scan button; `Submit Table 1` is the wide button at the panel foot.

- **Table-level action** (bottom, after a dashed rule): one `primary` button — `Submit Table 1` while editing (`POST …/table1/submit`, toast `Table 1 submitted.`), or `Modify Table 1` while frozen (`POST …/table1/modify`, toast `Table 1 re-opened for editing.`). These are non-silent and replace the whole session from the response.

> NOTE: **Vendor SKU Number** and **Remarks** are intentionally **not** rendered anywhere in Table 1. The ASO sees only the SKU *name*; the raw three serial columns and `matched`/`missing` booleans are collapsed into one `Serial No.` value + one `Status` badge.

### 6.3 Table 2 panel

- Visible once `session.table1_state === 'Submitted'` **or** any Table-2 row exists — gated on `session.table1_state === 'Submitted' || session.table2_rows?.length > 0`. Because Table 2 is **seeded at session start** (§4), the right operand is true from the first render for any location with accessory Vendor SKUs, so Table 2 is normally visible **immediately** — the ASO does not have to submit Table 1 first. The placeholder card (`Table 2 (Accessories) will appear after you submit Table 1.`) only appears in the edge case of a location with **zero** seeded accessory rows, while Table 1 is still Editing.
- Heading: `<h2>Table 2 (Accessories) · audit status</h2>`; meta `Increment the count against the Working / Not Working accessory.` When frozen, a `table-status` note: `Submitted — read-only. Use "Modify Table 2" below to edit.`
- **Table** with exactly five columns:

  | Column            | Source                                                                |
  |-------------------|-----------------------------------------------------------------------|
  | SKU Name          | `vendor_sku_name_snapshot` (`''` if null)                             |
  | Expected Item Qty | `expected_quantity`                                                   |
  | Working Count     | `working_count` via a `−` / value / `+` stepper                       |
  | Not Working Count | `not_working_count` via a `−` / value / `+` stepper                   |
  | Missing Count     | `missing_count` (blank while Editing/NULL, populated after Submit)    |

  Empty state (`colSpan=5`): `No active accessory Vendor SKUs to audit.`

  > NOTE: There is **no Vendor SKU Number column** in Table 2 — the first column is `SKU Name` (the name snapshot). The vendor SKU number is stored but not surfaced.

- The `−` button is disabled at value ≤ 0; the `+` button is disabled at value ≥ 10000 (the API limit). Tap targets are ≥ 32×32px.
- Each click is one **optimistic + silent** PATCH: local count bumps immediately (and clears `auto_suspended_at` locally — **unconditionally** here, including on the revert path, unlike Table 1's forward-only clear in §6.2), then `PATCH …/table2/rows/{rowId}` fires with `{ silent: true }` (absolute new value, not a delta); on failure the value reverts and a toast surfaces. A no-op (value unchanged, or out of `[0, 10000]`) sends nothing.
- **Table-header Submit / Modify**: identical model to Table 1 — `Submit Table 2` (`…/table2/submit`, toast `Table 2 submitted.`) populates Missing Count; `Modify Table 2` (`…/table2/modify`, toast `Table 2 re-opened for editing.`) clears it. Non-silent, full session replace.

### 6.4 Complete / Cancel buttons
- Both buttons render at the top of the page next to the AIN header, visible from the moment the session is `Incomplete`. Both require **confirmation** via the existing `<ConfirmModal>` component.

  - **Complete Audit Session <AIN>**:
    - Click → modal title `Complete Audit Session`, message `Complete this audit and submit the PAR for Store review? This freezes Table 1 and Table 2 and cannot be undone from this screen.`, confirm label `Complete`.
    - On confirm → `POST …/complete`. On 409 `audit_tables_not_submitted`, a toast surfaces the API message (which names the unsubmitted table). On success, the toast confirms `Audit <AIN> submitted for Store review.` and the screen re-fetches `/current` (re-rendering into the `PendingReview` block, §6.1 state 2).

  - **Cancel Audit Session <AIN>**:
    - Click → modal title `Cancel Audit Session`, message `Cancel this audit? The PAR will not be retained. This cannot be undone.`, confirm label `Cancel audit`, `danger`.
    - On confirm → `POST …/cancel`. On success, the toast confirms `Audit <AIN> cancelled.` and the screen re-fetches `/current` (re-rendering into the `none` Start view, §6.1 state 3).

### 6.5 Manage Locations — Assign ASO Users panel
- The **Assign Personnel → ASO Users** picker on the Manage Locations Modify form is already part of Phase 1 (`task1.md` §9 UI surface). Phase 3 makes **zero** UI changes to that form.
- The only Phase 3-visible behavior change is the new 409 `audit_location_in_use` error response (the location-assignment endpoint surfaces the offending `{ user_id, user_index, audit_index }` in the error envelope; the existing `<error-banner>` component renders it naming the user and the AIN).
- The Manage Users form has **no** location picker at all — the read-only "Assigned Audit Location" line on the Modify User form (Phase 1) deep-links to the Location detail page; from there the operator uses the Assign Personnel panel to make changes.

### 6.6 Responsive & accessibility
- Page conforms to Phase 1 §1.3 breakpoints. Below **768px** the tables collapse to the `.card-table` mobile pattern (`data-label="…"` per cell), already in `styles.css` (the `@media (max-width: 768px)` block; the page also has 640px and 480px breakpoints, but the table→card collapse and every audit-specific mobile rule below lives in the 768px block):
  - Table 1 **Summary** renders as compact, colour-coded stat tiles per SKU card.
  - Table 1 **Serial-detail** control cells stack (label over the Working/Not Working pill).
  - Table 2's stepper stays horizontal via its dedicated `.counter` layout so `−` value `+` don't wrap.
  - The per-SKU accent shows as a card top-stripe on mobile (vs the left border on desktop).
- The scan input is `type="text"` with `autoComplete="off"`, `inputMode="text"`, font-size ≥ 16px (prevents iOS Safari zoom on focus), and `enterKeyHint="send"`.
- The `±` counter buttons and pill toggles have keyboard equivalents (Tab → Space/Enter); stepper buttons are ≥ 32×32px.
- The auto-suspended banner is `role="status" aria-live="polite"`.

### 6.7 API parity
- Every audit operation is reachable via REST under `/audit-sessions/...` (§2, §3, §4) plus the read-only `/accessory-stock` (§5.2). The UI is a thin client; a script can run an audit end-to-end (start → pick SKU → scan → submit Table 1 → count → submit Table 2 → complete) without ever rendering the page.

### 6.8 Camera 1D barcode scanner
- `BarcodeScanner` is lazy-loaded (`lazy(() => import(...))` inside `<Suspense fallback={null}>`), mounted only when the camera is opened, so the ZXing engine (~450 kB) stays out of the initial bundle.
- It uses `BrowserMultiFormatReader` restricted to **1D formats only** (`CODE_128, CODE_39, CODE_93, EAN_13, EAN_8, UPC_A, UPC_E, ITF, CODABAR`) to avoid locking onto 2D/QR codes, opens the **rear** camera (`facingMode: { ideal: 'environment' }`), and on the first non-empty read stops the camera and hands the trimmed text to `handleBarcodeDetected` (which fills the serial in and immediately runs `addSerial` — hands-free, mimicking a hardware scanner).
- Wrapped in a `<Modal title="Scan barcode">` with a single `Cancel` button and the hint `Point the rear camera at the 1D barcode on the device label. It captures automatically.` Error states render a crimson message:
  - permission denied (`NotAllowedError`/`SecurityError`) → "Camera permission was denied. Allow camera access (and use HTTPS), then try again — or type the serial manually."
  - no usable camera (`NotFoundError`/`OverconstrainedError`) → "No usable camera was found on this device. Type the serial manually instead."
  - otherwise → "Could not start the camera. Type the serial manually instead."
- Manual keyboard entry is always retained; the camera is purely an alternative input that feeds the same `addSerial` path.

---

## 7. Validation Rules (consolidated)

### 7.1 Error code → user-facing message

| Code                              | HTTP | Message template                                                                                                                |
|-----------------------------------|------|---------------------------------------------------------------------------------------------------------------------------------|
| `audit_location_not_assigned`     | 422  | `You do not have an audit location assigned. Ask an Admin to set your location on your user profile before starting an audit.` |
| `audit_location_in_use`           | 409  | `Cannot change the user's location while they have an active or pending audit (<AIN>).` (Emitted by the Phase 3 inline in-flight-audit check in the `PUT /locations/{id}/assigned-users` handler — see §5.1. Fields `{user_id, user_index, audit_index}`.) |
| `audit_pending_review_block`      | 409  | `Previous audit <AIN> is awaiting Store review. Cannot start a new audit by the same user until the previous audit review is closed.` (fields `{audit_index}`) |
| `duplicate_scan`                  | 409  | `<S.No.> has already been audited in this session.` (fields `{serial_number}`)                                                  |
| `audit_session_frozen`            | 409  | `This audit is awaiting Store review and cannot be modified.`                                                                   |
| `audit_session_cancelled`         | 410  | `This audit was cancelled and cannot be modified.`                                                                              |
| `table1_frozen`                   | 409  | `Table 1 has been submitted. Press Modify to re-open it before changing scans.`                                                 |
| `table2_frozen`                   | 409  | `Table 2 has been submitted. Press Modify to re-open it before changing counts.`                                               |
| `audit_tables_not_submitted`      | 409  | `Both Table 1 and Table 2 must be submitted before completing the audit. Pending: <list>.` (fields `{pending:['Table 1'|'Table 2']}`) |
| `required_missing`                | 422  | `Required field 'serial_number' missing.` — or, for the SKU selection: `Select a SKU before entering a serial number.`         |
| `bad_format`                      | 422  | Serial: `Value '<raw>' for 'serial_number' is not a valid string (≤100 chars).` · working_status: `Value '<ws>' for 'working_status' is not a valid Working\|Not Working.` · remarks: `Value for 'remarks' is too long (max 500 chars).` / `Value for 'remarks' is not a valid string.` · counter: `Value '<v>' for '<field>' is not a valid non-negative integer (≤10000).` · SKU target: `Selected SKU is not a valid active serial-type Vendor SKU.` / `Selected SIM SKU is not a valid active SIM SKU.` / `Selected SKU group is empty or invalid.` |

The error envelope shape matches the Phase 1/2 convention: `{ error: <human message>, code: <machine code>, fields?: { … } }`. The frontend's existing `fieldMap` / `error-banner` pattern is reused verbatim; ASO toasts read `e?.data?.error || e.message` and `e?.data?.code`.

### 7.2 Concurrent-session guard
- The partial unique index `idx_audit_sessions_one_open` on `(auditor_user_id) WHERE status IN ('Incomplete','PendingReview') AND deleted_at IS NULL` is the correctness backstop. The API layer additionally pre-checks (`loadCurrentNonTerminal`) before INSERT to return the cleaner 200-on-resume / 409-on-pending-review behavior; if two requests reach INSERT simultaneously, the loser's INSERT fails with `23505`, the handler catches it, re-reads, and returns the resume path (200 or, if a PendingReview now exists, the block).

### 7.3 Transaction boundaries
- Every mutating endpoint runs in a single transaction containing **both** the audit-state change and the change-log insert(s). Session creation additionally contains the bulk Table-1 (three INSERT…SELECTs) + Table-2 seeds. Failure at any point rolls back the whole thing.
- The 5-minute suspension sweep (§1.5) is a single set-based `UPDATE` on the pool; it takes **no** advisory lock and writes **no** change-log row. (A user write that races it simply clears `auto_suspended_at` again on its own `bumpActivity`.)

### 7.4 Idempotency
- `POST /audit-sessions` is naturally idempotent for a single user thanks to the resume-existing-session rule. No `Idempotency-Key` header is required.
- `POST /audit-sessions/{id}/cancel` is idempotent (already-cancelled returns 200).
- `POST …/table1/submit`, `…/table1/modify`, `…/table2/submit`, `…/table2/modify` are each idempotent against their own target state (a second call with the table already in that state returns the shaped session, no writes).
- `POST /audit-sessions/{id}/complete` is **not** idempotent against a `PendingReview` row — re-posting returns 409 `audit_session_frozen`. Completion is a state transition users should see exactly once.
- The scan endpoint is **not** idempotent against repeats — the duplicate-scan guard is the mechanism that makes accidental double-scans safe.

---

## 8. Change-log integration (cross-cutting recap)

Per Phase 1 §10's minimal model, Phase 3 ASO writes exactly one `change_log` row per state change. `object_id` is the AIN string for session-level rows, the numeric PK (as string) for serial/accessory rows:

| Trigger                                              | object_type           | object_id          | action       |
|------------------------------------------------------|-----------------------|--------------------|--------------|
| `PUT /locations/{id}/assigned-users` that sets/changes `location_id` | `User`           | `<user_index>`     | `Update` (one row **per affected user**, emitted by that handler itself — no new object_type) |
| `POST /audit-sessions` (create)                      | `AuditSession`        | `<AIN>`            | `Create`     |
| `POST …/table1/scan` — expected hit                  | `AuditSerialRow`      | `<row_id>`         | `Update`     |
| `POST …/table1/scan` — unexpected / unregistered     | `AuditSerialRow`      | `<row_id>`         | `Create`     |
| `PATCH …/table1/rows/{row_id}` (effective change)    | `AuditSerialRow`      | `<row_id>`         | `Update`     |
| `POST …/table1/submit` or `…/table1/modify`          | `AuditSession`        | `<AIN>`            | `Update`     |
| `PATCH …/table2/rows/{row_id}` (effective change)    | `AuditAccessoryRow`   | `<row_id>`         | `Update`     |
| `POST …/table2/submit` or `…/table2/modify`          | `AuditSession`        | `<AIN>`            | `Update`     |
| `POST /audit-sessions/{id}/complete`                 | `AuditSession`        | `<AIN>`            | `Update`     |
| `POST /audit-sessions/{id}/cancel`                   | `AuditSession`        | `<AIN>`            | `SoftDelete` |

- No per-field diff (consistent with Phase 1 §10).
- The `change_log.object_type` column is free-form `TEXT`, so the three new values (`AuditSession`, `AuditSerialRow`, `AuditAccessoryRow`) need no migration. `UserAuditLocation` is **not** introduced — location changes are logged as `User` rows by the `assigned-users` handler itself.
- A PATCH (Table-1 row or Table-2 counter) that submits the same value as currently stored (idempotent no-op) does **not** write a change-log row, matching Phase 1 §10's invariant. The duplicate-scan and scan-target-error paths throw before any insert, so they too write no row. The suspension sweep writes no row.

---

## 9. Open product questions (still pending — defaults chosen; override at any point)

1. **Expected-row state filter (Table 1 seed)** — chose explicit inclusion allow-lists: `EXPECTED_PT_BS_STATES = ['Working','Retrieved Not Inspected','Installed','Under Repair','Repaired Not Inspected','In Transit']` and `EXPECTED_SIM_STATES = ['Active','Inactive','Blocked']`. Override by editing the arrays if other states should be included/excluded (e.g. dropping `In Transit`).
2. **Accessory Vendor-SKU vendor/status filter (Table 2 seed)** — **resolved to all vendors, any status**: seed every non-deleted accessory Vendor SKU (`serial_eligible = false`), Active **or** Inactive, regardless of vendor. The earlier Innoviti-only + Active-only gate was reversed. Override if accessory audit should re-narrow to Active-only or a single vendor.
3. **Missing-count clamping** — chose `GREATEST(expected - working - not_working, 0)`. Override if signed values (negative = "found extras") should be surfaced.
4. **Auto-suspension behavior** — chose "stays `Incomplete`, just sets `auto_suspended_at` via a 5-minute sweep at the 30-min idle threshold." Override if 30-min idle should hard-transition to a distinct status.
5. **Vendor-SKU activeness gate for SIM rows** — SIM Master's `vendor_sku_id` is NULL in practice, so the seed/scan gate for SIM is the joined Innoviti `skus.status = 'Active'` (while PT/BS gate on `vendor_skus.status = 'Active'`). Override (and switch SIM to `vendor_skus.status`) once the SIM loader populates `vendor_sku_id` and back-fills are run.
6. **Cancelled-session visibility** — chose hidden from Reports, retained in `change_log` and as soft-deleted rows for forensics. Override if Cancelled should be browsable.
7. **Non-ASO `users.location_id`** — chose "accept any FK without an Innoviti gate." Override if non-ASO users should never carry a `location_id`.
8. **Unregistered `matched` value** — **resolved to `matched = FALSE`** ("Matched" means *found in the Master*; an Unregistered serial is by definition not). The row still surfaces to the ASO via the `Unregistered` status badge. Override only if Reports must count Unregistered units as "audited/matched."

---

## 10. Out of scope for this slice

- **Store-user review of PendingReview audits** — the Approve / Reject flow that transitions `PendingReview → Completed` lives in the separate `docs/Audit_Store_User.docx` → `task/task3-stu.md` (or equivalent). That flow is the one that:
  - writes `last_audited_at`, `present_location_id`, `present_location_since` back into the three Master tables;
  - writes `working_quantity` / `not_working_quantity` back into `accessory_stock_balances`;
  - sets `audit_sessions.status = 'Completed'`.
- **Audit Reports screen** — the Reports tab and the Approved / Pending / Incomplete report listings live in `docs/Audit_Report.docx` → separate task file.
- **Activation of STU, ALU, RLU, FNU, LOU user types** — STU lands with the Store-review file; the others remain dormant.
- **Bulk-load of expected stock at audit time** — the audit reads existing Master tables; it does not import new stock. Stock loading remains the Phase 2 Load Stock journey.
- **Per-field old→new diff in the audit's change log** — Phase 1 §10 invariant; not adding for Phase 3.
- **Editing or deleting individual Table-1 rows directly** — the Modify button is the only retraction mechanism; the ASO view exposes no row delete and no Remarks editor.
- **Audit on behalf of another user** — SA/Admin cannot start, edit, or complete an audit owned by an ASO. Read-only access only (list + get-one + `/accessory-stock`).
- **Multi-location audit in one session** — each session is locked to one location (the value of `users.location_id` snapshotted at session start). Cross-location reconciliation is a future-phase concern.
- **Offline / queued scans when the network drops mid-session** — every scan is an online POST + session GET. Offline mode is not in scope.
- **A full Accessory Master object** — `accessory_stock_balances` is the minimum-viable quantity tracker introduced specifically for this audit slice. A first-class Accessory Master (with its own load journey, status, dispatch lifecycle) is a future-phase concern.
- **Parallel `user_audit_locations` join table** — explicitly removed (migration 018). The ASO's location lives on the `users.location_id` column (migration 017; `task1.md` §3); assignment rides on the Phase 1 `PUT /locations/{id}/assigned-users` endpoint (`routes/locations.js`).
- **Any DDL against the `users` table in Phase 3** — `users.location_id` is delivered by migration 017. Phase 3 makes no schema change to `users`.
- **Surfacing Vendor SKU Number or Remarks in the ASO Audit view** — both are stored in the schema but intentionally hidden from the ASO screen (§6.2, §6.3); they remain available to API clients and the Store-review slice.
