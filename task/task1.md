# Shakti Supply Chain Management System — Implementation Tasks
## How to read this document


This document is the build-ready task breakdown for the **first phase** of Shakti. It covers Section 0 (Foundations) and Section 1 (Object Creation) of `Object_requirements.docx`, plus the Design Constraints that touch those objects. It is stack-agnostic: no frameworks, languages, ORMs, or DB engines are named. Constraints referencing future-phase flows (orders, dispatch, retrieval, audit workflow) are dropped entirely from this phase. Out-of-scope items are listed in the footer.

---

## 1. Foundations (cross-cutting)

These rules apply to every other work package. Implement them once; reuse everywhere. 

### 1.1 Platform & device targets
- **Web app** delivered to desktop and mobile browsers.
- **Browsers**: Chrome, Safari, Bing (Edge-compatible).
- **OSes**: macOS, Windows, Linux on desktop; Android and iOS on mobile.
- **API & UI**: UI to be build over the API
### 1.2 Branding & typography
- Primary palette: **Purple** and **Orange**. **Grey** is used to highlight/accent.
- Font family across the application: **Raleway Light**.
- Apply to all screens, forms, dashboards, system-generated documents (toast, modal, email-style preview if any).

### 1.3 Responsive design
- Breakpoints: **768px** (tablet), **640px** (two-column → single-column), **480px** (mobile).
- All form inputs render at **≥16px** font size (prevents iOS Safari focus auto-zoom).
- Data tables horizontally scroll inside their card container, with a **min-width of 480px** to remain legible.
- Filter tab bars wrap gracefully onto multiple lines on narrow screens.
- Navigation chrome and main content area both adapt to the mobile viewport width.

### 1.4 Authentication
**Fields & types**
- `username` (string, required) — login identifier.
- `password` (string, required, write-only; stored as salted hash).
- `last_login_at` (timestamp, nullable).
- `password_reset_token` (string, nullable; single-use).
- `password_reset_token_expires_at` (timestamp, nullable).

**Seed behavior**
- A **Super Admin (SA)** account is seeded on first boot. The SA password is **hardcoded via a config secret** read at boot (e.g., environment variable / secret-store key). No SA self-registration flow.
- SA is the only entry point. SA creates all other users, including the first Admin.
- Google SSO is **deferred**. The login screen presents only username + password.

**API endpoints**
- `POST /auth/login` — username + password → session token.
- `POST /auth/logout` — invalidate current session.
- `POST /auth/password-reset/consume` — target user submits token + new password.
- Reset URL issuance is **per-user** and lives under the Users routes: `POST /users/{id}/password-reset-url` (SA/Admin only; see §3). The response is a copy-to-clipboard URL — no automated email is sent.

**Validation rules**
- Password reset token: single-use, **24h expiry**, invalidated immediately on consumption.
- Issuing a new reset URL for a user **invalidates any prior unconsumed reset URL** for that same user; only the most recently issued URL is valid.
- Inactive users are denied login (see User Status invariant).
- Failed login responses return a **generic failure message** ("Invalid credentials") regardless of whether the username exists. No response variant leaks user existence.

**Business rules / invariants**
- The only built-in privileged route at boot is the SA login. After SA logs in for the first time, the Initial Setup flow forces creation of the first Admin user (see Users §3).
- Deferred features (**Google SSO** and **Audit-Report Review**) are **hidden entirely** from the navigation until they ship. No nav entry, no greyed-out button, no backend route.

**UI surface**
- Public login screen (username + password). No "Sign in with Google" button is rendered.
- "Forgot password" link triggers SA/Admin-only reset workflow described above.
- Password reset consumption screen for end users (deep link from copied URL).

**Acceptance**
- SA can log in with the seeded credentials on a brand-new install.
- Wrong-credentials responses are byte-identical whether the username exists or not.
- A copied reset URL is single-use and expires 24h after issue.
- Issuing a second reset URL for the same user causes the first URL to return "link invalid" on consumption.

### 1.5 API-first architecture
- **Every** UI mutation must have an equivalent REST endpoint. There is no UI-only operation in this phase.
- All endpoints return JSON. List endpoints support pagination, search, and sort.
- All write endpoints require an authenticated session and enforce role gating (SA / Admin only for Section 1 objects).

### 1.6 Concurrency
- **Soft target**: 30 concurrent active sessions, without performance degradation.
- **No runtime enforcement** at user #31. Performance is the only design contract.

### 1.7 Data backup
- A **daily snapshot** of all object data is captured with a UTC **timestamp** in the snapshot identifier.
- Snapshot storage is **isolated** from the main application runtime (separate credentials, separate location).
- Snapshots are restore-only artifacts; the live application never reads from them directly.
- Super Admin will have a backup button to snapshot the database ask the user for a file name and save it.
- Super Admin will have a restore button which allow him to pick the database backup among the stored files and overwrite the database. 
- All API keys, User passwords and credentials should be stored in the backup so that, there is no loss of data.

### 1.8 Delete model
- **Soft delete everywhere.** Every object carries a `deleted_at` timestamp (nullable). A non-null value hides the row from default list responses but retains it for history and reports.
- Hard-delete rules don't apply anywhere.

### 1.9 Pincode → City/State derivation
- Every form with a Pincode field calls a **third-party API at form-fill time** (e.g., India Post lookup) to derive City and State.
- No bundled pincode table ships with the application.
- City and State derivation is **at the time of entry** and persisted on the object. Subsequent third-party changes do not retroactively update stored records.
- In case a pincode returns multiple cities, provide a dropdown for the user to pick the correct one.
- If the third-party lookup **fails or is unreachable**, the form **blocks submission** until City/State are resolved. A retry affordance is offered; the form cannot be saved without successful resolution.

### 1.10 Change log (see §10)
Every Section 1 object writes a **minimal** change-log entry on create/update/delete/status-toggle/upload (see Work Package 10 for the reduced schema and endpoints). The log captures only: object, actor, action, timestamp — no per-field old→new diff.

### 1.11 Authorization summary for Section 1
- **SA**: full CRUD on every Section 1 objects Not on User Types , only create and read is applicable.
- **Admin**: full CRUD on every Section 1 object **except** User Types (which only SA can edit) and the SA's own record.
- **Operational user types** (ASO, STU, ALU, RLU, FNU, LOU): **no access** to any Section 1 object in this phase. Their endpoints/screens land in later phases.

---

## 2. User Types

### Fields & types
- `user_type_id` (auto, internal).
- `code` (string, machine identifier;).
- `label` (string, 1–50 chars, displayed in pickers; editable per rules below).
- `is_seed` (boolean) — true for the eight seeded types.
- `is_immutable` (boolean) — true for `SA` and `ADMIN` only.
- `created_at`, `updated_at`, `deleted_at` (timestamp; `deleted_at` always null — no user types are deletable).

### Seeded rows
- `SA` (Super Admin) — immutable label, immutable existence.
- `ADMIN` (Admin) — immutable label, immutable existence.
- `ASO` (Area Service Officer), `STU` (Store User), `ALU` (Assembly Line User), `RLU` (Repair Line User), `FNU` (Finance User), `LOU` (Logistics User) — label **editable**, existence **locked**.

### API endpoints
- `POST   /user-types` — create new user type (SA only).
- `GET    /user-types/{id}` — read one.
- `GET    /user-types` — list.
- `PATCH  /user-types/{id}` — update label (SA only; blocked when `is_immutable` is true).
- **No DELETE** endpoint. (No user type may be deleted.)

### Validation rules
- `label` 1–50 characters, ASCII letters, digits, space, hyphen.
- `code` immutable after creation.
- `is_immutable` records reject any label change with HTTP 409.

### Business rules / invariants
- Only SA may create or edit User Types.
- Operational user types (ASO/STU/ALU/RLU/FNU/LOU and any SA-created types in this phase) **have no Section 1 access**. They are reserved for later-phase modules.

### UI surface
- **Manage User Types** screen: SA can edit (inline rename for non-immutable rows, plus an "Add User Type" button); Admin can read the list but every Modify affordance is disabled with a tooltip indicating SA-only edit access. Operational user types do not see the screen.

### Cross-object dependencies
- All Types have to have some seed value before objects which refer to them are created.

### Acceptance
- SA cannot delete any user type.
- Admin role cannot reach `/user-types` write endpoints (HTTP 403).

---

## 3. Users

### Fields & types
- `user_index` (string, auto, format `UIN-NNNNN` starting at `UIN-10001`, monotonic).
- `first_name` (string, **required**, 1–50 chars).
- `last_name` (string, **required**, 1–50 chars).
- `user_type_id` (FK → User Types, **required**).
- `email` (string, **required**, unique globally across Users, RFC-compliant).
- `mobile` (string, **optional**; if provided, exactly 10 digits, no country prefix, matches `^[6-9]\d{9}$`).
- `vendor_id` (FK → Vendors, **required**; defaults to the Innoviti vendor for every user type **except** `RLU` and `LOU`; **fully editable**).
- `employee_id` (string, conditional — see validation; format `IC/NNNN` or `INN/NNNN`, regex `^(IC|INN)/\d{4}$`).
- `address_line_1` (string, **optional**). **Not collected for ASO users** — the Add / Modify User form hides the address section when `user_type_id` resolves to `ASO`, and any address payload for an ASO is silently ignored. The columns remain on the schema for the other user types (`SA`, `ADMIN`, `STU`, `ALU`, `RLU`, `FNU`, `LOU`).
- `address_line_2` (string, optional). Same ASO-exclusion as above.
- `pincode` (string, 6 digits). Same ASO-exclusion as above.
- `city` (string, derived from pincode at form-fill). Same ASO-exclusion as above.
- `state` (string, derived from pincode at form-fill). Same ASO-exclusion as above.
- `location_id` (FK → Inventory Locations, **optional**, **nullable**). The user's home Inventory Location. Used by the Phase 3 Audit modules — ASO uses it to know which location to audit; STU uses it to know which store they belong to. **Not consumed** by any Phase 1 or Phase 2 flow. **Assignment happens from the Locations tab (§9)**, not from the User form — the User form does **not** show a location picker. The Innoviti-vendor gate (for ASO **and** STU) and the Phase 3 in-flight-audit guard fire on whichever endpoint mutates this column (today: the Locations tab's `PUT /locations/{id}/aso-users` and `PUT /locations/{id}/stu-users` endpoints — see §9).
- `status` (enum: `Active`, `Inactive`; default `Active`).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### API endpoints
- `POST   /users` — create (SA or Admin).
- `GET    /users/{id}` — read one.
- `GET    /users` — list, with filter by `status`, `user_type_id`, `vendor_id`.
- `PATCH  /users/{id}` — update (SA or Admin).
- `DELETE /users/{id}` — **soft delete**: sets `status = Inactive` and `deleted_at = now` (row retained).
- `POST   /users/{id}/status` — bidirectional Active↔Inactive toggle (SA or Admin).
- `POST   /users/{id}/password-reset-url` — issue a single-use 24h reset token; response is a copy-to-clipboard URL.
- `GET    /users/dashboard/summary` — returns total user count for the dashboard header.

### Validation rules
- `first_name`, `last_name`: 1–50 chars, ASCII letters plus space, hyphen, apostrophe; regex `^[A-Za-z][A-Za-z '\-]{0,49}$`.
- `email`: required, unique globally across all Users (case-insensitive comparison).
- `mobile`: optional for all user types; if provided, must match `^[6-9]\d{9}$`.
- `employee_id`: **required AND unique** when `vendor_id` resolves to the Innoviti vendor; **must not** be set when vendor != Innoviti (reject with 422).
- `pincode`: **required** 6 digits; City/State derived via third-party lookup. If lookup fails, allow save but flag for review.
- `user_type_id`: must reference an existing (non-deleted) User Type.
- `location_id`: not settable via `POST /users` or `PATCH /users/{id}` — both endpoints **ignore** the field if it appears in the request body, even from SA / Admin. Assignment is performed exclusively from the Locations tab: `PUT /locations/{id}/aso-users` for ASO users and `PUT /locations/{id}/stu-users` for STU users (§9). Both Phase 1 endpoints enforce the Innoviti-vendor gate, and Phase 3 layers a single in-flight-audit guard hook on each.
- **Address fields** (`address_line_1`, `address_line_2`, `pincode`, `city`, `state`): not collected when `user_type_id` resolves to `ASO`. The API silently drops any address values in the request payload for an ASO; existing rows that already have address values are left untouched (no destructive cleanup). For every other user type the original validation applies — `pincode` required 6 digits, city/state derived via pincode lookup.
- Cannot create another `SA` — system enforces a single SA seat (the seeded one).

### Business rules / invariants
- **Inactive users cannot log in.** Any auth attempt against an Inactive account is rejected.
- **Inactive-user retention**: stock against an Inactive user continues to show against them; their historical audits, dispatches received, and retrievals continue to display their name. Admin / store reports continue to render Inactive users.
- **Automatic password reset on reactivation**: when an Inactive user is set back to Active, the system issues a fresh single-use 24h reset URL for that user and surfaces it to the SA/Admin via the copy-to-clipboard affordance. The user must consume the URL to set a new password before they can log in.
- Soft-deleting a user is functionally equivalent to setting Status=Inactive.
- Operational users (ASO/STU/ALU/RLU/FNU/LOU) created here will exist with no Section 1 access in this phase.

### UI surface
- **Initial Setup screen**: shown to SA on first login; blocks all other navigation until the first Admin user is created.
- **Manage User dashboard**: total user count at top; list of users with `User Type`; inline actions **Modify**, **Delete**, **Copy Password Reset URL**; "Add User" button top-right.
- **Add User / Modify User form**: all schema fields with the two ASO-specific suppressions below; pincode lookup; vendor picker (defaults to Innoviti for non-RLU/LOU and remains editable); conditional Employee ID field shown only when vendor is Innoviti.
  - **Address section hidden for ASO**: when the selected `user_type_id` is `ASO`, the form's address block (Address Line 1/2, Pincode, City, State) is not rendered. Toggling the user type at form-fill time hides or re-shows the section without resetting the other fields. For every other user type the address section appears unchanged.
  - **No location picker on this form** for any user type. Location assignment for ASO users happens from the Locations tab — see §9. The Modify User form may surface a read-only "Assigned Audit Location" line for ASO users (showing the current `location_id` with a deep link to the Location detail page) but it is not editable here.
- **Confirm-via-popup** for Modify and Delete actions.

### Cross-object dependencies
- User Types must exist (seeded).
- Vendors must exist (Innoviti seed at minimum).
- Inventory Locations (§9) are not a precondition for creating any user — the `location_id` column starts NULL and is populated later from the Locations tab.

### Acceptance
- SA's first login lands on Initial Setup and cannot navigate elsewhere until an Admin is created.
- Creating a non-Innoviti user without Employee ID succeeds; creating an Innoviti user without Employee ID returns 422.
- Two users cannot share the same email.
- Deleting a user sets Status=Inactive; the user appears in historical reports but is denied login.
- Reactivating an Inactive user issues a fresh single-use 24h reset URL, surfaced via copy-to-clipboard. The prior password no longer works.
- Creating an ASO user with no address fields in the payload succeeds — the address columns remain NULL and the form's address section was hidden in the UI.
- `POST /users` and `PATCH /users/{id}` with `location_id` in the payload **ignore** the field — the column is unchanged. (ASO-location-assignment acceptance lives in §9 alongside the endpoint that actually mutates it.)

---

## 4. Contacts

### Fields & types
- `contact_index` (string, auto, format `NIN-NNNNN` starting at `NIN-10001`).
- `first_name` (string, **required**, 1–50 chars).
- `last_name` (string, **required**, 1–50 chars).
- `email` (string, **required**; uniqueness is **not** enforced — two Contacts may share the same email).
- `mobile` (string, **optional**; if provided, 10 digits, `^[6-9]\d{9}$`).
- `vendor_id` (FK → Vendors, **required**).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### API endpoints
- `POST   /contacts` — create (SA or Admin).
- `GET    /contacts/{id}` — read one.
- `GET    /contacts` — list, filterable by `vendor_id`, includes soft-deleted with `?include_deleted=true`.
- `PATCH  /contacts/{id}` — update.
- `DELETE /contacts/{id}` — **soft delete**.

### Validation rules
- Name fields: same regex as Users (`^[A-Za-z][A-Za-z '\-]{0,49}$`).
- `email`: required; **no uniqueness constraint** (duplicates across contacts are allowed).
- `mobile`: optional. **This is an explicit product override** of the original spec, which marked mobile as compulsory; the resolved decision is that mobile is non-compulsory for Contacts. If provided, must match `^[6-9]\d{9}$`.
- `vendor_id`: required; rejected if vendor does not exist or is soft-deleted.

### Business rules / invariants
- **Contact-requires-vendor invariant**: a Contact cannot be created or updated without a non-null `vendor_id` referencing an existing Vendor.
- **Soft-deleted contacts remain visible** in any Inventory Location where they were Principal or Secondary contact. The Location form continues to display the deleted contact's name, suffixed with `(deleted)`.
- A soft-deleted Contact is excluded from Contact pickers when creating new associations.

### UI surface
- **Manage Contacts** screen with filter by Vendor.
- **Add / Modify Contact** form, with the explicit mobile-optional note in the field help text.
- **Vendor detail page** has a "Contact Persons" hyperlink that lists all Contacts for the selected Vendor (see Vendors §6).

### Cross-object dependencies
- Vendor must exist before a Contact can be created.

### Acceptance
- Creating a Contact without a vendor returns 422.
- Two Contacts may share the same email address; the system does not reject duplicates.
- A Contact saved without a mobile number is accepted.
- After soft-deleting a Contact, opening a Location that referenced them still shows the name with `(deleted)`.

---

## 5. Vendor Types

### Fields & types
- `vendor_type_id` (auto, internal).
- `name` (string, 1–50 chars).
- `is_seed` (boolean) — true for the five seeded types.
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Seeded rows
- `Logistics Vendors`, `SKU Vendors`, `Service Vendors`, `Merchant`, `Innoviti`.

### API endpoints
- `POST   /vendor-types` — create (SA or Admin).
- `GET    /vendor-types/{id}` — read one.
- `GET    /vendor-types` — list.
- `DELETE /vendor-types/{id}` — **hard delete when unused**; 409 Conflict if any Vendor references it.
- **No PATCH endpoint.** Vendor Type names are immutable after creation. To "rename" a type, create a new type and migrate or replace usages.

### Validation rules
- `name`: 1–50 chars, unique (case-insensitive).
- `name`: **immutable after creation**. Any update attempt returns 405 (or 404 — no PATCH route exists).
- DELETE precondition: zero non-deleted Vendors reference this type. Soft-deleted Vendors do not block deletion (decision: the in-use check evaluates active references only).

### Business rules / invariants
- All Vendor Types — **including the Innoviti seed** — are **not editable** after creation. Names are fixed at create-time.
- All Vendor Types are deletable **only when unused**. Once any Vendor references it, the type cannot be deleted; the API returns 409 with the list of dependent vendors.

### UI surface
- **Manage Vendor Types** screen under Admin's "Modify Object Types" tab: list of types (read-only rows) with a Delete button per row; "Add Vendor Type" button at top. Delete button is disabled (with tooltip listing dependents) when in use. **No rename affordance.**

### Cross-object dependencies
- None upstream. Required before any Vendor of a custom type can be created.

### Acceptance
- Attempting to delete `SKU Vendors` when any Vendor uses it returns 409.
- A newly created type can be deleted while no Vendor references it.

---

## 6. Vendors

### Fields & types
- `vendor_index` (string, auto, format `VEN-NNNNN` starting at `VEN-10001`).
- `company_name` (string, **required**, 1–100 chars).
- `vendor_type_id` (FK → Vendor Types, **required**).
- `gst_number` (string, conditional — see validation; regex `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`).
- `registered_office` (object — **distinct sub-address block**):
  - `line_1` (string, required).
  - `line_2` (string, optional).
  - `pincode` (string, 6 digits).
  - `city` (derived from pincode).
  - `state` (derived from pincode).
- `operational_address`:
  - `address_line_1` (string, required) — operational address.
  - `address_line_2` (string, optional).
  - `pincode` (string, 6 digits).
  - `city` (derived from pincode).
  - `state` (derived from pincode).
- `status` (enum: `Active`, `Inactive`; default `Active`).
- `created_at`, `updated_at`, `deleted_at` (timestamps).


### Seeded rows
- One **Innoviti** vendor seeded at boot. Its `gst_number` may be null. It cannot be soft-deleted while any user/contact/location/SKU references it (which is always).

### API endpoints
- `POST   /vendors` — create (SA or Admin).
- `GET    /vendors/{id}` — read one. Response includes a `contact_persons_url` for the hyperlinked Contacts view.
- `GET    /vendors/{id}/contacts` — list all Contacts whose `vendor_id` matches.
- `GET    /vendors` — list, filterable by `status`, `vendor_type_id`.
- `PATCH  /vendors/{id}` — update.
- `DELETE /vendors/{id}` — **soft delete**, but **blocked** with 409 if any dependent record exists (Contacts, Users, Inventory Locations, Vendor SKUs owned by this vendor). SA must toggle Status=Inactive instead.
- `POST   /vendors/{id}/status` — toggle Active/Inactive (SA or Admin).

### Validation rules
- `company_name`: required.
- `gst_number`: **required AND unique** for every vendor **except** the seeded Innoviti vendor (where it may be null). Must match the GSTIN regex.
- `vendor_type_id`: must reference an existing (non-deleted) Vendor Type.
- Registered office and operational address are independent fields — both pincode lookups happen separately.
- `status` can be changed only by SA or Admin.

### Business rules / invariants
- The seeded Innoviti vendor cannot be hard-deleted under any condition.
- **Inactive vendors remain visible in every picker** (Users vendor dropdown, Contacts vendor dropdown, Locations vendor dropdown, Vendor SKU vendor dropdown) and on every detail page, **annotated with an "(Inactive)" badge** next to the company name. They can still be selected for new associations; the badge is the only signal of their status.
- Hard delete is **never** offered; the DELETE endpoint performs soft delete only when no dependents exist, otherwise responds 409.

### UI surface
- **Manage Vendors** screen with filter chips for Status and Vendor Type.
- **Add / Modify Vendor form**: company info, vendor type picker, GST field (hidden / not required for the Innoviti default row only), the registered-office sub-address block visually separated from the operational address block, status toggle.
- **Vendor detail page**: header with company info; a **Contact Persons** hyperlink that navigates to a list of Contacts whose `vendor_id` matches; lists of associated Users, Locations, and Vendor SKUs owned by this vendor.

### Cross-object dependencies
- Vendor Types must exist.

### Acceptance
- Creating a non-Innoviti vendor without GST returns 422.
- DELETE on a vendor that has any Contact / User / Location / Vendor SKU reference returns 409 with the dependency list.
- An Inactive vendor still appears on the User detail page of a user previously tagged to it.
- Clicking the Contact Persons hyperlink lists exactly the Contacts whose `vendor_id` matches.

---

## 7. SKU Types

### Fields & types
- `sku_type_id` (auto, internal).
- `name` (string, **required**, unique, 1–50 chars).
- `serial_eligible` (boolean) — controls whether SKUs of this type may have STM=Serial.
- `is_seed` (boolean).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### Seeded rows
| Name | serial_eligible |
|---|---|
| Payment Terminal | **true** |
| Base Station | **true** |
| SIM Card | **true** |
| Assembly Line Assets | false |
| Adaptors | false |
| USB cables | false |
| Paper rolls | false |
| Tools | false |
| Consumables | false |
| Spare Parts | false |

### API endpoints
- `POST   /sku-types` — create (SA or Admin).
- `GET    /sku-types/{id}` — read one.
- `GET    /sku-types` — list.
- `PATCH  /sku-types/{id}` — update name only. **`serial_eligible` is not accepted** by this endpoint (rejected with 422 if present).
- **No DELETE endpoint.** SKU types are non-deletable once created (product decision: they remain on file for historical and reporting purposes).

### Validation rules
- `name`: unique (case-insensitive).
- `serial_eligible`: boolean; **immutable after creation**. The flag must be set correctly at create-time; to change the eligibility of a type, create a new type and migrate.
- **Not deletable.** SKU types live forever.

### Business rules / invariants
- **Nothing is hardcoded** about which SKU Type can have STM=Serial. The `serial_eligible` flag is the single source of truth. STM=Serial on an SKU is allowed **only if** the SKU's type has `serial_eligible = true` at the moment of SKU save/update.
- Adaptor / USB SKU pickers on Payment Terminal SKUs rely on the existence of SKU Types literally named `Adaptors` and `USB cables`. If a Payment Terminal SKU is created with no candidate Adaptor/USB SKU rows present, the save is blocked (see SKU §8).

### UI surface
- **Manage SKU Types** screen under Admin's "Modify Object Types" tab: list with inline rename and a **read-only** `serial_eligible` indicator. "Add SKU Type" button. The `serial_eligible` flag is set only on the Add form and cannot be toggled on existing rows. **No delete affordance is rendered** — SKU types are permanent.

### Cross-object dependencies
- None upstream.

### Acceptance
- Creating an SKU of a type whose `serial_eligible` is false with STM=Serial returns 422.
- Payment Terminal SKUs will always be through Serial Number.
- SKU Types cannot be deleted — no DELETE endpoint exists, and the SKU creation picker always shows every SKU Type that has ever been created.

---

## 8. SKU 

### 8.1 Innoviti SKU 

#### Fields & types
- `sku_number` (string, auto, format `INN-NNNNN` starting at `INN-10001`).
- `sku_name` (string, **required**, 1–100 chars).
- `description` (string, free text).
- `stm` (enum: `Serial`, `None`, **required**).
- `sku_type_id` (FK → SKU Types, **required**, **immutable after creation**).
- `specifications_pdf` (file ref → object storage; **optional**; PDF, **≤10 MB**; **latest version only** — a new upload overwrites the previous file).
- `approx_price_moq` (integer ≥1, **optional**) and `approx_price_unit` (decimal, ≥0, **optional**) — together represent Approximate price per unit (MOQ + unit price). Either may be null at create time.
- `status` (enum: `Active`, `Inactive`; default `Active`).
- **Conditional, only when `sku_type_id` resolves to "Payment Terminal":**
  - `adaptor_sku_ids` (array of FK → SKU where type=Adaptors, **required, non-empty**, multi-select).
  - `usb_cable_sku_ids` (array of FK → SKU where type=USB cables, **required, non-empty**, multi-select).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

#### Relationships — Innoviti SKU ↔ Vendor SKU mapping
An Innoviti SKU may map to zero or more **Vendor SKUs** (§8.3.a) through the **`sku_vendor_links`** many-to-many table (§8.3.b). The mapping records "which Vendor SKU(s) supply this Innoviti SKU". Users mutate the set only via the Innoviti SKU Create and Modify forms — there is no stand-alone link-management screen and no dedicated `/skus/{sku_id}/vendor-skus` REST surface.

- **Cardinality.** One Innoviti SKU → zero-to-many Vendor SKUs; one Vendor SKU → zero-to-many Innoviti SKUs. Both sides must share the **same `sku_type_id`** for a link to be accepted.
- **Optional at create and modify.** An Innoviti SKU is created first and may exist with zero links (the matching Vendor SKU may not exist yet). Both `POST /skus` and `PATCH /skus/{id}` accept an optional `vendor_sku_ids` array; an empty/omitted array is fine. PATCH reconciles the link set: ids not currently linked are inserted, links no longer in the array are soft-deleted, the rest are left untouched — all in one transaction.
- **Default supplier.** Exactly one link per Innoviti SKU may carry `is_default = true`. On create, the first id supplied becomes the default. On PATCH the existing default is preserved when still in the supplied set; if it was removed, the first remaining link (by `sku_vendor_link_id`) is auto-promoted. If the new set is empty, the SKU has no default until the next PATCH supplies one.
- **Persistence.** The Innoviti SKU itself (the `skus` row) carries **no** vendor / vendor SKU columns; everything lives in `sku_vendor_links`. `vendor_sku_ids` is a transient payload field plus a read-only convenience array on `GET /skus` / `GET /skus/{id}` (so the Modify form can pre-populate).
- **Lifecycle.** Inserts happen only inside `POST /skus` or `PATCH /skus/{id}`; soft-deletes happen inside `PATCH /skus/{id}` (reconciliation) or cascade from `DELETE /vendor-skus/{id}` (§8.3.a). There are no standalone `/skus/{sku_id}/vendor-skus/...` routes for any role.
- **Phase 2 dependency.** The Payment Terminal and Base Station load journeys walk this mapping in reverse: a row's `(owner, vendor_sku_number)` resolves to a Vendor SKU, then `sku_vendor_links` resolves to the Innoviti SKU whose `sku_id` is stamped on the master row (see task2.md §6.5). If an Innoviti SKU has no live link to a needed Vendor SKU, PT/BS loads will fail with `vendor_sku_not_found` until the link is added via a Modify.

#### API endpoints
- `POST   /skus` — create (SA or Admin).
- `GET    /skus/{id}` — read one (includes the list of linked Vendor SKUs with their `is_default` flag).
- `GET    /skus` — list, filterable by `sku_type_id`, `status`, `vendor_id` (matches Innoviti SKUs linked through any non-deleted Vendor SKU owned by the given vendor).
- `PATCH  /skus/{id}` — update; `sku_type_id` is rejected if changed.
- `DELETE /skus/{id}` — **soft delete** (sets `status = Inactive` and `deleted_at`).
- `POST   /skus/{id}/status` — toggle Active/Inactive (SA or Admin).
- `POST   /skus/{id}/specifications` — upload a new specifications PDF (≤10 MB). **Overwrites** the existing file; previous file is not retained.

#### Validation rules
- `sku_name`: must be **unique (case-insensitive) within its SKU Type** among non-deleted SKUs. Creating — or renaming — a SKU to a name already used by another SKU of the same type is rejected. Enforced both in the API and by a partial unique index `(LOWER(sku_name), sku_type_id) WHERE deleted_at IS NULL`. The same name **is** allowed under a different SKU Type.
- `sku_type_id`: required at create, **immutable on update**. Attempting to change returns 422.
- `stm` is **fully determined by the SKU type**:
  - If the SKU Type's `serial_eligible` is **true** (Payment Terminal, Base Station, SIM Card, or any custom serial-eligible type), `stm` **must be `Serial`** — `None` is rejected with 422.
  - If `serial_eligible` is **false**, `stm` must be `None` — `Serial` is rejected with 422.
  - The UI locks the STM dropdown the moment a type is picked and auto-sets the correct value, so the field can never be wrong from the form.
- `specifications_pdf`: MIME must be `application/pdf`; size ≤ **10 MB**.
- Payment Terminal save **fails with 422** if either `adaptor_sku_ids` or `usb_cable_sku_ids` cannot be resolved to at least one candidate row (i.e., no Adaptor SKUs exist, or no USB cable SKUs exist). The error response instructs the user to create the prerequisite records first.
- `vendor_sku_ids`: **optional** on both `POST /skus` (create) and `PATCH /skus/{id}` (modify). An Innoviti SKU is created first and may have **zero** Vendor SKUs at create time (the matching Vendor SKU may not exist yet); the link set can be revised later by re-submitting `vendor_sku_ids` on PATCH. If supplied, every referenced Vendor SKU must (a) exist, (b) be non-deleted, and (c) have the **same `sku_type_id`** as the Innoviti SKU — otherwise 422. On create, the first id supplied becomes the default supplier. On PATCH the existing default is preserved when still in the set; if removed, the first remaining link is auto-promoted. See §8.3.b for the link semantics.

#### Business rules / invariants
- **SKU Type is immutable.** To change type, create a new SKU.
- **PDF storage**: object storage, **latest version only** (new uploads overwrite the previous file), **10 MB cap** per file.
- Setting an Adaptor / USB SKU referenced by an Active Payment Terminal SKU to Inactive is **allowed**, but:
  - The deactivation flow shows a warning listing the dependent Payment Terminal SKUs.
  - The dependent Payment Terminal SKU's detail page **highlights the stale reference in red**.
- Soft delete is reversible by toggling Status back to Active (subject to the standard role gating).

#### UI surface
- **Manage SKUs** screen with filters for Type, Status, Vendor.
- **Add Innoviti SKU form** — Payment Terminal type **reveals** the Adaptor / USB multi-select widgets; other types hide them. A "Vendor SKUs (optional)" multi-select is shown for every SKU Type **only after the SKU Type has been picked**; the list is filtered to non-deleted Vendor SKUs whose `sku_type_id` matches the picked SKU Type, and switching the SKU Type clears any prior picks. If no Vendor SKUs of the picked SKU Type exist, the section displays a soft hint ("No vendor SKUs of this type yet — you can create them later on Manage Vendor SKU; the Innoviti SKU can still be saved without one") and the user proceeds with zero picks.
- **Modify Innoviti SKU form** — same fields editable as today, plus the same "Vendor SKUs (optional)" multi-select that appears on Create. It is pre-populated with the currently-linked Vendor SKUs (from `GET /skus/{id}.vendor_sku_ids`), and the user may tick/untick any to revise the link set. Submitting reconciles `sku_vendor_links` (additions inserted, removals soft-deleted) inside the PATCH transaction. SKU Type is immutable, so the multi-select stays filtered to the same SKU Type as at create.
- **Innoviti SKU detail page** — header with SKU metadata. **No** stand-alone "Vendor SKUs" panel and **no** "+ Link Vendor SKU" affordance — link management lives on the Modify form (cross-ref Relationships above). Dependent-reference warnings (stale Adaptor/USB references on Payment Terminal SKUs) are highlighted in red.


#### Cross-object dependencies
- SKU Types and Vendors must exist. A Vendor SKU is **not** required to create an Innoviti SKU.

#### Acceptance
- Creating an Innoviti SKU with no `vendor_sku_ids` returns HTTP 201 (Vendor SKU is optional). The new SKU has zero rows in `sku_vendor_links`.
- Creating an Innoviti SKU that references a Vendor SKU of a different SKU Type returns 422.
- Creating an Innoviti SKU with valid same-type `vendor_sku_ids` returns 201, and the first id in the array is marked `is_default = true` in `sku_vendor_links`.
- Creating a Payment Terminal SKU with no existing Adaptor SKU returns 422 with a clear "create Adaptor SKU first" message.
- PATCH that attempts to change `sku_type_id` returns 422.
- A 15 MB (or any >10 MB) PDF upload is rejected.
- Setting an Adaptor SKU to Inactive shows a warning enumerating dependent Payment Terminal SKUs; on confirm, the dependent Payment Terminal SKU page renders the Adaptor reference in red.

### 8.2 Terminal Parent SKU — REMOVED

The Terminal Parent SKU object that previously lived in §8.2 has been removed from the system. Payment Terminal SKUs no longer carry a `parent_sku_id`; the `/terminal-parent-skus` routes no longer exist; the change-log enum no longer carries a `TerminalParentSku` value. The slot is retained to preserve §8 sub-numbering; no current object lives here.

### 8.3 Vendor SKU (first-class entity) and Innoviti↔Vendor SKU links

The legacy "SKU↔Vendor association" row (`sku_vendor_assoc`) is gone. A **Vendor SKU** is now a first-class object owned by exactly one Vendor: it carries its own number, name, MOQ, unit price, spec PDF, SKU Type, and status. The same Vendor SKU may supply **many** Innoviti SKUs through a separate **link** table (`sku_vendor_links`) whose only payload is the `is_default` flag.

#### 8.3.a Vendor SKU (`vendor_skus`)

#### Fields & types
- `vendor_sku_id` (auto, internal).
- `vendor_id` (FK → Vendors, **required**, **immutable after creation**; the Vendor may be Active or Inactive — Inactive vendors remain selectable, see §6).
- `sku_type_id` (FK → SKU Types, **required at creation**, **immutable after creation**). Lets the Innoviti SKU create screen filter vendor SKUs to ones of the matching category, and the backend enforces that every link stays within one SKU Type.
- `vendor_sku_number` (string, **required**) — the vendor's own part number. **Unique within its `vendor_id`** among non-deleted rows.
- `vendor_sku_name` (string, optional, 1–100 chars) — the vendor's own product name; surfaced in pickers and listings.
- `vendor_sku_price_moq` (integer ≥1, optional).
- `vendor_sku_price_unit` (decimal, ≥0, optional).
- `vendor_sku_specification_pdf` (file ref → object storage; PDF, **≤10 MB**; **latest version only** — new uploads overwrite the previous file).
- `status` (enum: `Active`, `Inactive`; default `Active`).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

#### API endpoints
- `POST   /vendor-skus` — create (SA or Admin). Required body: `vendor_id`, `sku_type_id`, `vendor_sku_number`.
- `GET    /vendor-skus/{id}` — read one (includes vendor name and SKU Type name). **Does not** expose a list of linked Innoviti SKUs (the link table is internal — see §8.3.b).
- `GET    /vendor-skus` — list with filters `vendor_id`, `sku_type_id`, `status`, `include_deleted`.
- `PATCH  /vendor-skus/{id}` — update vendor SKU number / name / MOQ / unit price. `vendor_id` and `sku_type_id` are **immutable** and rejected if changed.
- `POST   /vendor-skus/{id}/status` — toggle Active/Inactive.
- `DELETE /vendor-skus/{id}` — **soft delete**. Existing rows in `sku_vendor_links` that reference this Vendor SKU are also soft-deleted in the same transaction (cascading internal cleanup); no 409 guard is rendered because the link table is not user-visible.
- `POST   /vendor-skus/{id}/restore` — restore a soft-deleted Vendor SKU (subject to the `(vendor_id, vendor_sku_number)` uniqueness check). Cascaded link soft-deletes are **not** auto-restored.
- `POST   /vendor-skus/{id}/specification` — upload (overwrite) the spec PDF. ≤10 MB.
- `GET    /vendor-skus/{id}/specification` — fetch the current spec PDF.

#### Validation rules
- `(vendor_id, vendor_sku_number)`: unique among non-deleted rows — enforced by a partial unique index.
- `vendor_id`, `sku_type_id`: required at create; both must reference an existing, non-deleted row; both immutable on PATCH.
- `vendor_sku_specification_pdf`: PDF MIME; ≤10 MB; new uploads overwrite the prior file.

#### Business rules / invariants
- A Vendor SKU is owned by exactly one Vendor and lives in exactly one SKU Type — both are immutable. To "move" a Vendor SKU to a different vendor or type, create a new Vendor SKU.
- An Inactive Vendor SKU still appears in pickers, annotated; soft-deleted ones do not.
- The link table (`sku_vendor_links`) is internal and never surfaced on `GET /vendor-skus*`. The Manage Vendor SKU screen does **not** render a "Linked Innoviti SKUs" column.

#### UI surface
- **Manage Vendor SKU** screen. Each row is one Vendor SKU. Columns: Vendor, SKU Type, Vendor SKU Number, Vendor SKU Name, MOQ, Unit price, Status, Spec PDF (View / Upload / Replace), Actions (Modify / Activate-Deactivate / Delete; Restore for soft-deleted rows). Filters: Vendor, SKU Type, Show deleted. **No** "Linked Innoviti SKUs" column.
- **Add Vendor SKU modal**: Vendor (required), SKU Type (required), Vendor SKU Number (required), Vendor SKU Name (optional), MOQ, Unit price.
- **Modify Vendor SKU modal**: Vendor and SKU Type are shown disabled (immutable); only number, name and price fields are editable.

#### Cross-object dependencies
- Vendors and SKU Types must exist.

#### Acceptance
- Creating a Vendor SKU without `sku_type_id` returns 422.
- Two Vendor SKUs of the same vendor cannot share a vendor SKU number; same number under a different vendor is accepted.
- A PATCH that attempts to change `vendor_id` or `sku_type_id` returns 422.
- DELETE on any Vendor SKU succeeds with a soft delete; any non-deleted `sku_vendor_links` rows referencing it are soft-deleted in the same transaction (no 409 surfaced).
- `GET /vendor-skus/{id}` response carries vendor name and SKU Type name but no `linked_skus` array.

#### 8.3.b Innoviti SKU ↔ Vendor SKU link (`sku_vendor_links`)

This table records the Innoviti SKU ↔ Vendor SKU mapping for Phase 2 load resolution (see task2.md §6.5) and for the Innoviti SKU Manage page's vendor-count column. There is **no stand-alone management screen** and **no `/skus/{sku_id}/vendor-skus` REST surface**. The link set is mutated exclusively from the Innoviti SKU Create and Modify forms (via `POST /skus` and `PATCH /skus/{id}`). The current ids are surfaced read-only as `vendor_sku_ids` on `GET /skus` and `GET /skus/{id}` so the Modify form can pre-populate.

#### Fields & types
- `sku_vendor_link_id` (auto, internal).
- `sku_id` (FK → Innoviti SKU, **required**).
- `vendor_sku_id` (FK → Vendor SKU, **required**).
- `is_default` (boolean, default `false`) — marks this link as the **default supplier** for the Innoviti SKU. Maintained internally; not exposed on any read.
- `created_at`, `updated_at`, `deleted_at` (timestamps).

#### API endpoints
The link table is mutated only by the Innoviti SKU handlers and read only via the Innoviti SKU read paths:
- `POST /skus` — inserts a link row for each id in the optional `vendor_sku_ids` array (atomic with the SKU create).
- `PATCH /skus/{id}` — when `vendor_sku_ids` is supplied, reconciles the link set: ids not currently linked are inserted, links absent from the array are soft-deleted, the rest are untouched. Same-SKU-Type validation applies.
- `GET /skus` / `GET /skus/{id}` — return a `vendor_sku_ids` array (live, non-deleted links, ordered by `sku_vendor_link_id`) so the Modify form can pre-populate.
- Soft-deleting a Vendor SKU via `DELETE /vendor-skus/{id}` cascades to soft-delete its links (§8.3.a).

There is **no standalone `/skus/{sku_id}/vendor-skus` route surface** (no GET, POST, PATCH, DELETE, or restore). Any such path returns 404.

#### Validation rules (enforced inside `POST /skus` and `PATCH /skus/{id}`)
- `(sku_id, vendor_sku_id)`: unique across non-deleted rows — enforced by a partial unique index. Duplicate ids in the same `vendor_sku_ids` array are de-duplicated server-side; at most one row per pair is inserted.
- At most one non-deleted link per `sku_id` may have `is_default = true` — enforced by a partial unique index.
- **Same-SKU-Type rule**: every id in `vendor_sku_ids` must reference a Vendor SKU whose `sku_type_id` matches the Innoviti SKU's `sku_type_id`. Any mismatch fails the whole request with 422; no partial inserts persist.

#### Business rules / invariants
- **Optional at create and modify.** Both `POST /skus` and `PATCH /skus/{id}` accept an empty/omitted `vendor_sku_ids` — zero links is a valid state.
- **Reconciled by `POST /skus` and `PATCH /skus/{id}`.** The Innoviti SKU handlers are the only paths that mutate `sku_vendor_links`. There is no per-link route (`POST/PATCH/DELETE /skus/{sku_id}/vendor-skus/...`).
- **Default supplier.**
  - On create with non-empty `vendor_sku_ids`, the first id becomes `is_default = true`.
  - On PATCH, the existing default is preserved when its id is still in the supplied set. If the default was removed (or no default existed and at least one link survives), the first remaining link (by `sku_vendor_link_id`) is auto-promoted in the same transaction.
  - If the post-PATCH link set is empty, the SKU has no default until a later PATCH supplies one.
- **Soft delete cascade.** Soft-deleting a Vendor SKU (§8.3.a) soft-deletes every non-deleted `sku_vendor_links` row that referenced it, in the same transaction.

#### UI surface
- No standalone screen renders the contents of `sku_vendor_links`.
- The only interaction is the "Vendor SKUs (optional · same SKU Type · editable after creation)" multi-select on the Innoviti SKU Create and Modify forms (§8.1). On Modify it is pre-populated from `GET /skus/{id}.vendor_sku_ids` and submits the revised array as part of the regular PATCH body.

#### Cross-object dependencies
- Innoviti SKU, Vendor SKU, and (through Vendor SKU) Vendor and SKU Type must exist.

#### Acceptance
- Creating an Innoviti SKU with empty / omitted `vendor_sku_ids` succeeds (HTTP 201) and writes zero rows to `sku_vendor_links`.
- Creating an Innoviti SKU with valid same-type `vendor_sku_ids` succeeds and writes one `sku_vendor_links` row per id; the first id is `is_default = true`, the others `is_default = false`.
- Creating or PATCHing an Innoviti SKU with a Vendor SKU of a different SKU Type returns 422; no partial link mutations persist.
- PATCHing `vendor_sku_ids` to a set that adds A and removes B leaves any other existing link untouched; A is inserted, B is soft-deleted, and one `SkuVendorLink/Create` + one `SkuVendorLink/SoftDelete` change-log row are written.
- PATCHing `vendor_sku_ids` to a set that excludes the current default and includes other ids promotes the first surviving link (by `sku_vendor_link_id`) to default in the same transaction.
- There is no `/skus/{sku_id}/vendor-skus` route exposed by the application — any request to such a path returns 404.
- Soft-deleting a Vendor SKU cascades to soft-delete its non-deleted link rows; the Vendor SKU's own soft-delete succeeds without a 409 guard.

---

## 9. Inventory Locations

### Fields & types
- `location_index` (string, auto, format `LIN-NNNNNNNN` starting at `LIN-10000001`, 8 digits).
- `vendor_id` (FK → Vendors, **required**; **editable by SA only** post-creation).
- `location_name` (string, **required**, 1–100 chars;).
- `address_line_1` (string, required).
- `address_line_2` (string, optional).
- `pincode` (string, 6 digits).
- `city` (derived from pincode).
- `state` (derived from pincode).
- `principal_contact_id` (FK → Contacts, **required**; Contact must have `vendor_id` equal to this Location's `vendor_id`).
- `secondary_contact_id` (FK → Contacts, **optional**; if set, must differ from `principal_contact_id` and must belong to the same vendor).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

**Derived (not columns on `locations`)**:
- `assigned_aso_user_ids` — the list of `users.user_id` values where `users.location_id = <this location_id> AND users.user_type_code = 'ASO' AND users.deleted_at IS NULL`. Surfaced in API responses (see GET below) and mutated atomically via `PUT /locations/{id}/aso-users` below.
- `assigned_stu_user_ids` — same construction as above but with `user_type_code = 'STU'`. Mutated via `PUT /locations/{id}/stu-users` (the STU parallel endpoint described below).
- Both projections come from the same single-FK column on the user row (`users.location_id`, §3); they differ only in the user-type filter applied. A user has at most one `location_id`, so a user appears in at most one Location's projection at any time.

**No Status field.** Soft delete is the only retirement mechanism.

### API endpoints
- `POST   /locations` — create (SA or Admin).
- `GET    /locations/{id}` — read one. Response includes resolved Principal/Secondary contact display names (with `(deleted)` suffix when contact is soft-deleted), an `assigned_aso_users` array `[{ user_id, user_index, first_name, last_name, email }]`, and an `assigned_stu_users` array of the same shape.
- `GET    /locations` — list, filterable by `vendor_id`.
- `PATCH  /locations/{id}` — update; updates to `vendor_id` are **SA only**. Existing Principal/Secondary contacts are **kept as-is** across the vendor change (no clearing, no re-pick prompt). The cross-vendor contact reference is allowed and persists until SA explicitly edits the contact pickers. **Does not** accept the ASO-assignment field — use the dedicated endpoint below.
- `PUT    /locations/{id}/aso-users` — **set the full list** of ASO users assigned to this Location. Body: `{ "user_ids": [<int>, ...] }`. SA or Admin only. Behaviour:
  - For every `user_id` in the new list that is not already assigned here: set `users.location_id = <this location_id>` (additive).
  - For every user **currently** assigned to this location whose `user_id` is **not** in the new list: set `users.location_id = NULL` (clear).
  - Runs as a single transaction; partial failure rolls back the whole set.
  - Each affected user is validated individually — see Validation rules. A 422 / 409 on any single user aborts the whole call with that user named in the error envelope.
  - Writes one `change_log` row of `(User, <user_index>, actor, Update)` per affected user (same convention `PATCH /users/{id}` would have produced — preserves audit symmetry).
- `PUT    /locations/{id}/stu-users` — exact parallel to `/aso-users` but scoped to STU users. Body, transaction semantics, and change-log emission are identical. Validation differs only in the user-type check: each `user_id` must resolve to `user_type_code = 'STU'`, otherwise 422 `store_location_user_not_stu`. The Innoviti-vendor gate and the Phase 3 in-flight-audit guard fire here in exactly the same way they fire on `/aso-users` (see `task/task3-stu.md` §5.1 for the STU-side guard hook).
- `DELETE /locations/{id}` — **soft delete**. Soft-deleting a Location whose `assigned_aso_users` **or** `assigned_stu_users` is non-empty returns 409 `location_has_assigned_users` with both lists named — assignment must be cleared first via `PUT .../aso-users` and/or `PUT .../stu-users` with an empty list.

### Validation rules
- `location_name`: required; **no uniqueness constraint** — duplicates within or across vendors are allowed.
- `principal_contact_id`: required; **at the moment of assignment** (create, or whenever the contact picker is edited), the chosen Contact must be non-deleted and have `vendor_id` equal to the Location's current `vendor_id`. After a subsequent vendor change on the Location, the existing principal reference is preserved even if it no longer matches the new vendor.
- `secondary_contact_id`: if provided, same vendor rule **at the moment of assignment**, and must not equal `principal_contact_id`.
- `vendor_id`: at create, any Vendor (Active or Inactive — see §6). On update, mutable **only by SA**; contact references are not cleared on the change.
- **`PUT /locations/{id}/aso-users` validation** — applied per `user_id` in the supplied list:
  - User must exist and not be soft-deleted → 422 `aso_user_not_found`.
  - User's `user_type_code` must be `ASO` → 422 `audit_location_user_not_aso`.
  - The location's `vendor_id` must match the seeded Innoviti vendor → 422 `audit_location_vendor_not_innoviti`. (Non-Innoviti locations cannot be assigned to ASOs at all — assignment rejects up-front rather than rejecting per-user.)
  - Phase 3 only: if the user has any `audit_sessions` row with `status IN ('Incomplete','PendingReview')` AND `deleted_at IS NULL`, the assignment change for that user is rejected with 409 `audit_location_in_use` and the offending AIN. (Same guard described in `task/task3-aso.md` §5.1 — it now fires on this endpoint instead of the user-update endpoint.) Applies symmetrically to additions, removals, and "user reassigned from another location to this one."
  - User IDs are de-duplicated server-side; a duplicated id in the request is silently collapsed.
- **`PUT /locations/{id}/stu-users` validation** — same shape as the ASO block above with three substitutions:
  - User-type check uses `STU`; the error code on a mismatch is 422 `store_location_user_not_stu` (analogue of `audit_location_user_not_aso`).
  - Innoviti-vendor gate uses error code 422 `store_location_vendor_not_innoviti`.
  - Phase 3 in-flight-audit guard checks `store_audit_sessions` (not `audit_sessions`) for non-terminal rows owned by the user; on a hit the response is 409 `store_location_in_use` with the offending Store-AIN. See `task/task3-stu.md` §5.1.

### Business rules / invariants
- **Deleted contacts retained in display**: a Contact that was Principal or Secondary on this Location continues to render on the Location form even after Contact soft-delete, with the `(deleted)` suffix.
- **Vendor change does not clear contacts**: when SA changes a Location's `vendor_id`, the existing `principal_contact_id` and `secondary_contact_id` references are preserved as-is, even if those contacts now belong to a different Vendor. The Location form continues to render those contacts; SA may edit the pickers later if desired.
- Soft-deleted Locations remain referenced by historical inventory records (when those modules ship in later phases).

### UI surface
- **Manage Locations** screen with Vendor filter.
- **Add / Modify Location form**: vendor picker (disabled on edit for non-SA roles), location name, address with pincode lookup, Principal and Secondary contact pickers scoped to the chosen Vendor's Contacts list. When SA changes the vendor on an existing Location, the contact pickers display the previously selected (possibly cross-vendor) contacts; the dropdowns themselves still list only the new Vendor's contacts for fresh selection. A small "(other vendor)" annotation appears next to a contact name whose vendor no longer matches the Location's vendor.
- If the chosen Vendor has zero non-deleted Contacts, the Principal-contact picker shows an inline message — "No contacts exist for this Vendor — add a contact first" — and the form blocks submission until a Contact is created.
- **Assign Personnel panel** (Modify Location only, below the contact pickers): a labelled section titled `Assign this Location to…` with three stacked sub-pickers.
  - **Contacts** — read-only summary of the Principal / Secondary contacts already set above. Contact-to-Location assignment continues to live in the Principal / Secondary pickers (no duplicate writeable picker here).
  - **ASO Users** — a multi-select dropdown of active ASO users (search by name / `user_index` / email). The dropdown opens only when the Location's vendor is Innoviti; for any other vendor the picker is replaced with the inline message `ASO assignment is available only for Innoviti-vendor locations.` Below the picker, currently assigned ASOs render as removable chips. Adding or removing a chip triggers a single `PUT /locations/{id}/aso-users` call with the new full list; the per-user validation errors (`audit_location_user_not_aso`, `audit_location_in_use`, etc.) surface as toasts naming the offending user.
  - **STU Users** — same shape as the ASO sub-picker but bound to `PUT /locations/{id}/stu-users`; same Innoviti-only gate, same chip / confirm-to-reassign UX. Errors use the STU-prefixed codes (`store_location_user_not_stu`, `store_location_in_use`).
  - Each picker shows a confirmation modal when adding a user who is **already assigned to another location** — `Reassign <First Last> from <Other Location> to this Location?` — and on confirm performs the move in one call.
- The Add Location form does **not** show the Assign Personnel panel — assignment is only possible after the Location row exists.

### Cross-object dependencies
- Vendor must exist.
- At least one Contact for that Vendor must exist before a Location can be saved (to satisfy mandatory Principal contact).

### Acceptance
- Creating a Location without a Principal contact returns 422.
- Setting Secondary = Principal returns 422.
- A non-SA user attempting to PATCH `vendor_id` on a Location is rejected (403).
- Two Locations with the same name under the same Vendor (or across different Vendors) are both accepted — `location_name` has no uniqueness constraint.
- After SA changes a Location's `vendor_id`, the prior Principal/Secondary contacts remain on the Location detail page even though they now belong to a different Vendor.
- A soft-deleted Contact that was once Principal still appears on the Location detail with `(deleted)`.
- `PUT /locations/{innoviti_loc_id}/aso-users` with two valid ASO `user_ids` sets both users' `users.location_id` to this location and returns the updated `assigned_aso_users` list. A follow-up `GET /users/{id}` on either ASO returns the new `location_id`.
- `PUT /locations/{innoviti_loc_id}/aso-users` with one existing ASO removed from the list clears that user's `location_id` to NULL.
- `PUT /locations/{non_innoviti_loc_id}/aso-users` with any non-empty list returns 422 `audit_location_vendor_not_innoviti` and writes nothing.
- `PUT /locations/{id}/aso-users` including the id of a non-ASO user returns 422 `audit_location_user_not_aso` and writes nothing.
- `PUT /locations/{id}/aso-users` including the id of an ASO who currently has an in-flight audit session (Phase 3 onwards) returns 409 `audit_location_in_use` naming the AIN and writes nothing.
- All five acceptance criteria above hold for `PUT /locations/{id}/stu-users` with `STU` substituted for `ASO`, `store_location_*` substituted for `audit_location_*`, and `store_audit_sessions` substituted for `audit_sessions`.
- Soft-deleting a Location whose `assigned_aso_users` **or** `assigned_stu_users` is non-empty returns 409 `location_has_assigned_users`; clearing the offending list(s) first via the appropriate `PUT .../{aso|stu}-users` with `{ user_ids: [] }` allows the delete to succeed.

---

## 10. Change Log (cross-cutting, minimal)

A single change-log facility records **one row per mutation** on every Section 1 object. The log is intentionally minimal: it answers "who did what, to which object, when" — not "which field changed from X to Y." Per-field diff history is **out of scope**.

### Fields & types
- `change_log_id` (auto, internal).
- `object_type` (enum: `User`, `UserType`, `Contact`, `Vendor`, `VendorType`, `SKU`, `SKUType`, `VendorSku`, `SkuVendorLink`, `Location`). The legacy `SKUVendorAssociation` value is dropped — Vendor SKUs and Innoviti↔Vendor SKU links are now two distinct objects (see §8.3). `SkuVendorLink` rows are written by `POST /skus` and `PATCH /skus/{id}` (Create / SoftDelete during reconciliation; Update when the default supplier is auto-promoted) and by `DELETE /vendor-skus/{id}` (SoftDelete via cascade). The link table has no standalone REST surface.
- `object_id` (string) — the target object's primary key (in its native format, e.g., `UIN-10001`, `VEN-10005`).
- `actor_user_id` (FK → Users) — who performed the change.
- `actor_user_index` (string) — denormalized snapshot of the actor's `user_index` at the time of change (preserved across actor renames/soft deletes).
- `action` (enum: `Create`, `Update`, `SoftDelete`, `HardDelete`, `StatusToggle`, `Upload`).
- `occurred_at` (timestamp, UTC).

One mutation = one row. There is **no** `field_name`, `old_value`, or `new_value` column.

### API endpoints
- `GET /change-log` — query by `object_type` + `object_id`, by `actor_user_id`, by date range. Admin and SA only.
- `GET /change-log/{object_type}/{object_id}` — convenience endpoint returning the timeline for one object.
- `GET /users/{id}/change-log` — convenience endpoint returning all changes made **by** that user.

### Validation rules
- Read-only via API. There is no Create / Update / Delete endpoint on the change log itself; all writes happen synchronously inside the originating object's mutation handler.
- Queries require Admin or SA role.
- A PATCH that produces **no actual field change** (idempotent no-op) **does not** write a change-log row.

### Business rules / invariants
- Every Section 1 mutation writes its log row in the same transaction as the mutation. If log write fails, the parent mutation must fail.
- Soft delete → `action = SoftDelete`. Hard delete (Vendor Types when unused) → `action = HardDelete`.
- Status toggles (`Active`/`Inactive`) on Users, Vendors, Innoviti SKUs, Vendor SKUs → `action = StatusToggle`.
- PDF uploads (Innoviti SKU spec, Vendor SKU spec) → `action = Upload`.

### UI surface
- **No per-object Activity / History panel** in this phase.
- Admin-only **Global Change Log** screen with filters: object type, object id, actor, date range. Lists `(timestamp, actor, object_type, object_id, action)` rows; no diff column.

### Cross-object dependencies
- Attaches to every other Section 1 object.

### Acceptance
- Renaming a Vendor produces exactly one row with `action = Update`, the actor, and a timestamp.
- Soft-deleting a User produces exactly one row with `action = SoftDelete`.
- A PATCH that submits the same values as currently stored produces zero log rows.
- Admin can query the global log; operational user types cannot.

---

## Out of scope for this phase

- Google SSO authentication (nav entry present but disabled; no backend route).
- Audit report review by Admin (nav entry present but disabled; no backend route).
- Audit module workflow itself — sessions, scans, Provisional Audit Report, reviews. The user-level `location_id` field is provided in this phase (§3) so the schema is ready, but it is **not consumed** until Phase 3. The "block changes while an audit is in flight" guard, audit-session tables, and all audit endpoints land in Phase 3.
- Order generation, partial-shipment splitting, and split-order numbering rules.
- Dispatch and retrieval flows.
- MIS reporting and report builders.
- Load Data journeys (`_Load_data_requirements.txt`).
- Master records derived from Load Data — Payment Terminal Master, SIM Card Master, Base Station Master, Load Stock.
- Inventory state machine (in-transit vs at-location) — modeled in a later phase when orders/dispatch ship.
- Operational user-type access to any Section 1 object — operational types exist but have no permissions in this phase.
