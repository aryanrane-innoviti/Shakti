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

### 1.12 Object creation hierarchy & association direction
Shakti follows a strict **top-down creation order**, and every association is recorded on the **inferior (child) object** — the lower object in the hierarchy carries the foreign key and exposes the picker that attaches it to its parent. There is **no "assign from the parent" screen**; a parent's list of children is always a read-only derived projection on the parent's detail page.

**Cold-start creation order** (each step depends on the ones above it):
1. **Defaults (seeded at boot)** — the Super Admin user, the Innoviti vendor, and the **Bangalore HO** Inventory Location (owned by the Innoviti vendor). The seeded SA is tied to Bangalore HO (`users.location_id`).
2. **Admin** — the first Admin user, created in Initial Setup, tied to **Bangalore HO** by default.
3. **Vendors** — all SKU/other vendors, each with its registered + operational address (§6).
4. **Inventory Locations** — created against a Vendor; the Location carries `vendor_id` (§9).
5. **Users** — created against a Location; location-eligible user types carry `location_id`, set on the User form (§2 `location_eligible`, §3).
6. **Vendor SKUs** — created against a Vendor; the Vendor SKU carries `vendor_id` (§8.3.a).
7. **Innoviti SKUs** — created under Innoviti, optionally linked to one or more Vendor SKUs via `sku_vendor_links` (§8.1, §8.3.b).
8. **Contacts** — created against a Vendor **and** (optionally) a Location; the Contact carries `vendor_id` + `location_id` (§4).

**Association-direction rule (applies everywhere):** the picker that creates an association lives on the inferior object's Create/Modify form — the **User** form attaches a Location, the **Contact** form attaches a Vendor + Location, the **Location** form attaches a Vendor, the **Vendor SKU** form attaches a Vendor. Superior objects (Vendor, Location) render their children only as read-only lists on their detail pages.

---

## 2. User Types

### Fields & types
- `user_type_id` (auto, internal).
- `code` (string, machine identifier;).
- `label` (string, 1–50 chars, displayed in pickers; editable per rules below).
- `is_seed` (boolean) — true for the eight seeded types.
- `is_immutable` (boolean) — true for `SA` and `ADMIN` only.
- `location_eligible` (boolean) — when **true**, Users of this type attach an Inventory Location on the User Create / Modify form (the form renders a Location picker; see §3). When **false**, the User form shows no location picker and `location_id` stays NULL. Set at create-time; editable by SA via PATCH **for custom types only** (fixed for the eight seeded types). Turning it **off** hides the picker for future edits but does **not** clear `location_id` on existing users.
- `created_at`, `updated_at`, `deleted_at` (timestamp; `deleted_at` always null — no user types are deletable).

### Seeded rows
- `SA` (Super Admin) — immutable label, immutable existence. `location_eligible = true` (the seeded SA is tied to Bangalore HO).
- `ADMIN` (Admin) — immutable label, immutable existence. `location_eligible = true` (the first Admin is tied to Bangalore HO).
- `ASO` (Area Service Officer), `STU` (Store User) — label **editable**, existence **locked**, `location_eligible = true` (ASO's audit location / STU's store location).
- `ALU` (Assembly Line User), `RLU` (Repair Line User), `FNU` (Finance User), `LOU` (Logistics User) — label **editable**, existence **locked**, `location_eligible = false`.

### API endpoints
- `POST   /user-types` — create new user type (SA only). Body accepts `label` and `location_eligible` (boolean, default `false`).
- `GET    /user-types/{id}` — read one.
- `GET    /user-types` — list.
- `PATCH  /user-types/{id}` — update `label` and/or `location_eligible` (SA only; the **label** change is blocked when `is_immutable` is true, and `location_eligible` is fixed on all eight seeded types — see validation).
- **No DELETE** endpoint. (No user type may be deleted.)

### Validation rules
- `label` 1–50 characters, ASCII letters, digits, space, hyphen.
- `code` immutable after creation.
- `is_immutable` records reject any label change with HTTP 409.
- `location_eligible`: boolean. Settable on `POST /user-types` (default `false`) and editable via `PATCH` for **custom** types only; on the eight **seeded** types it is fixed at its seeded value and any change attempt returns 409.

### Business rules / invariants
- Only SA may create or edit User Types.
- Operational user types (ASO/STU/ALU/RLU/FNU/LOU and any SA-created types in this phase) **have no Section 1 access**. They are reserved for later-phase modules.

### UI surface
- **Manage User Types** screen: SA can edit (inline rename for non-immutable rows, plus an "Add User Type" button); Admin can read the list but every Modify affordance is disabled with a tooltip indicating SA-only edit access. Operational user types do not see the screen.
- The **Add User Type** form shows a **"Location associated?"** toggle that sets `location_eligible`; each row displays the flag as a read-only badge (editable by SA on custom rows; fixed on the eight seeded rows).

### Cross-object dependencies
- All Types have to have some seed value before objects which refer to them are created.

### Acceptance
- SA cannot delete any user type.
- Admin role cannot reach `/user-types` write endpoints (HTTP 403).
- Creating a custom user type with `location_eligible = true` causes the User form to render a Location picker when that type is selected; a type with `location_eligible = false` shows no picker.

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
- `location_id` (FK → Inventory Locations, **optional**, **nullable**). The user's home Inventory Location. Rendered on the User Create / Modify form **only when the selected user type is `location_eligible`** (§2); for non-eligible types the field is hidden and stays NULL. Consumed by the Phase 3 Audit modules — ASO uses it to know which location to audit; STU uses it to know which store they belong to — but it is now **set directly on the User form** (association lives on the inferior object, §1.12). The vendor-match rule (the Location's vendor must equal the user's vendor) and the Phase 3 in-flight-audit guard fire on the User write endpoints (`POST /users`, `PATCH /users/{id}`) that mutate this column. The seeded SA and the first Admin default to the **Bangalore HO** location (§9 seed).
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
- `location_id`: **settable via `POST /users` and `PATCH /users/{id}`** when the user's type is `location_eligible`; for a non-eligible type any `location_id` in the body is ignored and the column stays NULL. When set, the referenced Location must exist and not be soft-deleted (else 422 `location_not_found`), and its `vendor_id` must equal the **user's** `vendor_id` (else 422 `user_vendor_mismatch`) — so the picker only offers the user's own vendor's Locations. There is **no** Innoviti-specific restriction; an ASO/STU defaults to the Innoviti vendor (`vendor_id` above), so its locations are Innoviti locations by virtue of the vendor-match rule, not a hardcoded gate.
  - **Phase 3 in-flight-audit guard**: changing `location_id` on an ASO/STU who has a non-terminal audit session is rejected with 409 (`audit_location_in_use` / `store_location_in_use`) naming the offending AIN.
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
  - **Location picker shown for location-eligible types**: when the selected user type's `location_eligible` is true (§2), the form renders a **Location** picker that writes `location_id`. The picker lists non-deleted Locations **of the user's selected vendor** (so an ASO/STU on the Innoviti vendor sees Innoviti locations). For non-eligible types no picker is shown. The seeded SA and the Initial-Setup Admin form default this picker to **Bangalore HO**.
- **Confirm-via-popup** for Modify and Delete actions.

### Cross-object dependencies
- User Types must exist (seeded).
- Vendors must exist (Innoviti seed at minimum).
- Inventory Locations (§9) must exist before a `location_eligible` user can be tied to one. At cold start the **Bangalore HO** location is seeded (§9), so the Initial-Setup Admin can be tied to it immediately. For non-eligible user types, Locations are not a precondition (`location_id` stays NULL).

### Acceptance
- SA's first login lands on Initial Setup and cannot navigate elsewhere until an Admin is created.
- Creating a non-Innoviti user without Employee ID succeeds; creating an Innoviti user without Employee ID returns 422.
- Two users cannot share the same email.
- Deleting a user sets Status=Inactive; the user appears in historical reports but is denied login.
- Reactivating an Inactive user issues a fresh single-use 24h reset URL, surfaced via copy-to-clipboard. The prior password no longer works.
- Creating an ASO user with no address fields in the payload succeeds — the address columns remain NULL and the form's address section was hidden in the UI.
- `POST /users` / `PATCH /users/{id}` with `location_id` set succeed for a `location_eligible` type and persist the column; the same payload against a non-eligible type leaves `location_id` NULL.
- Assigning any location-eligible user to a Location whose vendor differs from the user's vendor returns 422 `user_vendor_mismatch` and writes nothing.

---

## 4. Contacts

### Fields & types
- `contact_index` (string, auto, format `NIN-NNNNN` starting at `NIN-10001`).
- `first_name` (string, **required**, 1–50 chars).
- `last_name` (string, **required**, 1–50 chars).
- `email` (string, **required**; uniqueness is **not** enforced — two Contacts may share the same email).
- `mobile` (string, **optional**; if provided, 10 digits, `^[6-9]\d{9}$`).
- `vendor_id` (FK → Vendors, **required**).
- `location_id` (FK → Inventory Locations, **optional**, **nullable**). The Location this Contact belongs to — the association lives on the Contact (the inferior object) per §1.12. When set, the Location's `vendor_id` must equal the Contact's `vendor_id`. A Contact may be vendor-wide (no Location) or tied to exactly one Location.
- `created_at`, `updated_at`, `deleted_at` (timestamps).

### API endpoints
- `POST   /contacts` — create (SA or Admin).
- `GET    /contacts/{id}` — read one.
- `GET    /contacts` — list, filterable by `vendor_id` and `location_id`, includes soft-deleted with `?include_deleted=true`.
- `PATCH  /contacts/{id}` — update.
- `DELETE /contacts/{id}` — **soft delete**.

### Validation rules
- Name fields: same regex as Users (`^[A-Za-z][A-Za-z '\-]{0,49}$`).
- `email`: required; **no uniqueness constraint** (duplicates across contacts are allowed).
- `mobile`: optional. **This is an explicit product override** of the original spec, which marked mobile as compulsory; the resolved decision is that mobile is non-compulsory for Contacts. If provided, must match `^[6-9]\d{9}$`.
- `vendor_id`: required; rejected if vendor does not exist or is soft-deleted.
- `location_id`: optional; if provided, the Location must exist, be non-deleted, and have `vendor_id` equal to the Contact's `vendor_id` (else 422 `contact_location_vendor_mismatch`). A `vendor_id` change that leaves the set Location mismatched is rejected until the Location is cleared or changed.

### Business rules / invariants
- **Contact-requires-vendor invariant**: a Contact cannot be created or updated without a non-null `vendor_id` referencing an existing Vendor.
- **Contact-owns-Location**: the Contact ↔ Location association lives entirely on the Contact (`location_id`). The Location object no longer references Contacts (Principal/Secondary pickers are removed, §9). A Location's "Contacts at this location" list is a read-only derived projection of Contacts whose `location_id` matches.
- **Soft-deleted contacts remain visible** on the Location detail page's derived "Contacts at this location" list, suffixed with `(deleted)`.
- A soft-deleted Contact is excluded from Contact pickers when creating new associations.

### UI surface
- **Manage Contacts** screen with filters by Vendor and Location.
- **Add / Modify Contact** form, with the explicit mobile-optional note in the field help text, plus an **optional Location picker** scoped to the chosen Vendor's non-deleted Locations (enabled only after a Vendor is selected; changing the Vendor clears a now-mismatched Location).
- **Vendor detail page** has a "Contact Persons" hyperlink that lists all Contacts for the selected Vendor (see Vendors §6).
- **Location detail page** shows a read-only "Contacts at this location" list (Contacts whose `location_id` matches), with `(deleted)` suffix for soft-deleted ones.

### Cross-object dependencies
- Vendor must exist before a Contact can be created. A Location is **optional**; if one is attached it must already exist and belong to the same Vendor.

### Acceptance
- Creating a Contact without a vendor returns 422.
- Two Contacts may share the same email address; the system does not reject duplicates.
- A Contact saved without a mobile number is accepted.
- Creating a Contact with a `location_id` whose Location belongs to a different Vendor returns 422 `contact_location_vendor_mismatch`.
- A Contact may be saved with no Location (vendor-wide); it then appears on no Location's derived contacts list.
- After soft-deleting a Contact that had a `location_id`, the Location detail page's "Contacts at this location" list still shows the name with `(deleted)`.

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
- Adaptor / USB-cable pickers on **Payment Terminal Vendor SKUs** rely on the existence of SKU Types literally named `Adaptors` and `USB cables`. If a Payment Terminal Vendor SKU is created with no candidate Adaptor / USB-cable **Vendor SKU** rows present, the save is blocked (see Vendor SKU §8.3.a).

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
- *(Adaptor / USB-cable references are **not** carried by the Innoviti SKU.* They live on the physical **Vendor SKU** of type "Payment Terminal" — see §8.3.a `adaptor_vendor_sku_ids` / `usb_cable_vendor_sku_ids`. The Innoviti SKU is a broad classification; each physical Vendor SKU describes its own adaptor + cable.)*
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
- `vendor_sku_ids`: **optional** on both `POST /skus` (create) and `PATCH /skus/{id}` (modify). An Innoviti SKU is created first and may have **zero** Vendor SKUs at create time (the matching Vendor SKU may not exist yet); the link set can be revised later by re-submitting `vendor_sku_ids` on PATCH. If supplied, every referenced Vendor SKU must (a) exist, (b) be non-deleted, and (c) have the **same `sku_type_id`** as the Innoviti SKU — otherwise 422. On create, the first id supplied becomes the default supplier. On PATCH the existing default is preserved when still in the set; if removed, the first remaining link is auto-promoted. See §8.3.b for the link semantics.

#### Business rules / invariants
- **SKU Type is immutable.** To change type, create a new SKU.
- **PDF storage**: object storage, **latest version only** (new uploads overwrite the previous file), **10 MB cap** per file.
- Adaptor / USB-cable handling (including the "component went Inactive" warning) now lives on the **Vendor SKU** (§8.3.a), not on the Innoviti SKU.
- Soft delete is reversible by toggling Status back to Active (subject to the standard role gating).

#### UI surface
- **Manage SKUs** screen with filters for Type, Status, Vendor.
- **Add Innoviti SKU form** — A "Vendor SKUs (optional)" multi-select is shown for every SKU Type **only after the SKU Type has been picked**; the list is filtered to non-deleted Vendor SKUs whose `sku_type_id` matches the picked SKU Type, and switching the SKU Type clears any prior picks. If no Vendor SKUs of the picked SKU Type exist, the section displays a soft hint ("No vendor SKUs of this type yet — you can create them later on Manage Vendor SKU; the Innoviti SKU can still be saved without one") and the user proceeds with zero picks.
- **Modify Innoviti SKU form** — same fields editable as today, plus the same "Vendor SKUs (optional)" multi-select that appears on Create. It is pre-populated with the currently-linked Vendor SKUs (from `GET /skus/{id}.vendor_sku_ids`), and the user may tick/untick any to revise the link set. Submitting reconciles `sku_vendor_links` (additions inserted, removals soft-deleted) inside the PATCH transaction. SKU Type is immutable, so the multi-select stays filtered to the same SKU Type as at create.
- **Innoviti SKU detail page** — header with SKU metadata. **No** stand-alone "Vendor SKUs" panel and **no** "+ Link Vendor SKU" affordance — link management lives on the Modify form (cross-ref Relationships above). Adaptor / USB-cable references (and their stale-reference warnings) are shown on the **Vendor SKU**, not here.


#### Cross-object dependencies
- SKU Types and Vendors must exist. A Vendor SKU is **not** required to create an Innoviti SKU.

#### Acceptance
- Creating an Innoviti SKU with no `vendor_sku_ids` returns HTTP 201 (Vendor SKU is optional). The new SKU has zero rows in `sku_vendor_links`.
- Creating an Innoviti SKU that references a Vendor SKU of a different SKU Type returns 422.
- Creating an Innoviti SKU with valid same-type `vendor_sku_ids` returns 201, and the first id in the array is marked `is_default = true` in `sku_vendor_links`.
- PATCH that attempts to change `sku_type_id` returns 422.
- A 15 MB (or any >10 MB) PDF upload is rejected.
- *(Adaptor/USB-cable acceptance lives in §8.3.a — the Innoviti SKU no longer carries those fields.)*

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
- **Conditional, only when `sku_type_id` resolves to "Payment Terminal":**
  - `adaptor_vendor_sku_ids` (JSONB array of FK → Vendor SKU whose type = `Adaptors`; **required, non-empty**, multi-select).
  - `usb_cable_vendor_sku_ids` (JSONB array of FK → Vendor SKU whose type = `USB cables`; **required, non-empty**, multi-select).
  - The referenced adaptor / cable Vendor SKUs may belong to **any** vendor (no same-vendor restriction); each must be live (non-deleted) and of the matching SKU Type. For every other SKU Type these two columns stay NULL.
- `created_at`, `updated_at`, `deleted_at` (timestamps).

#### API endpoints
- `POST   /vendor-skus` — create (SA or Admin). Required body: `vendor_id`, `sku_type_id`, `vendor_sku_number` (plus `adaptor_vendor_sku_ids` + `usb_cable_vendor_sku_ids` when the type is Payment Terminal).
- `GET    /vendor-skus/{id}` — read one (includes vendor name and SKU Type name, and resolves `adaptor_vendor_sku_ids` / `usb_cable_vendor_sku_ids` into `adaptors` / `usb_cables` arrays of `{ vendor_sku_id, vendor_sku_number, vendor_sku_name, status }`). **Does not** expose a list of linked Innoviti SKUs (the link table is internal — see §8.3.b).
- `GET    /vendor-skus` — list with filters `vendor_id`, `sku_type_id`, `status`, `include_deleted`; each row resolves its adaptor / USB-cable components the same way as the read-one endpoint.
- `PATCH  /vendor-skus/{id}` — update vendor SKU number / name / MOQ / unit price, plus `adaptor_vendor_sku_ids` / `usb_cable_vendor_sku_ids` when the (immutable) type is Payment Terminal. `vendor_id` and `sku_type_id` are **immutable** and rejected if changed.
- `POST   /vendor-skus/{id}/status` — toggle Active/Inactive.
- `DELETE /vendor-skus/{id}` — **soft delete**. Existing rows in `sku_vendor_links` that reference this Vendor SKU are also soft-deleted in the same transaction (cascading internal cleanup); no 409 guard is rendered because the link table is not user-visible.
- `POST   /vendor-skus/{id}/restore` — restore a soft-deleted Vendor SKU (subject to the `(vendor_id, vendor_sku_number)` uniqueness check). Cascaded link soft-deletes are **not** auto-restored.
- `POST   /vendor-skus/{id}/specification` — upload (overwrite) the spec PDF. ≤10 MB.
- `GET    /vendor-skus/{id}/specification` — fetch the current spec PDF.

#### Validation rules
- `(vendor_id, vendor_sku_number)`: unique among non-deleted rows — enforced by a partial unique index.
- `vendor_id`, `sku_type_id`: required at create; both must reference an existing, non-deleted row; both immutable on PATCH.
- `vendor_sku_specification_pdf`: PDF MIME; ≤10 MB; new uploads overwrite the prior file.
- **Payment Terminal components**: when `sku_type_id` resolves to "Payment Terminal", both `adaptor_vendor_sku_ids` and `usb_cable_vendor_sku_ids` are **required and non-empty**, and every id must resolve to a live Vendor SKU of type `Adaptors` / `USB cables` respectively (else 422). If **no** candidate Adaptor / USB-cable Vendor SKUs exist at all, the save is blocked with 422 telling the user to create the prerequisite Vendor SKU(s) first. For non-Payment-Terminal types the fields are ignored. On PATCH (type immutable) the references are revalidated only when the existing type is Payment Terminal.

#### Business rules / invariants
- A Vendor SKU is owned by exactly one Vendor and lives in exactly one SKU Type — both are immutable. To "move" a Vendor SKU to a different vendor or type, create a new Vendor SKU.
- An Inactive Vendor SKU still appears in pickers, annotated; soft-deleted ones do not.
- Setting an adaptor / USB-cable Vendor SKU that is referenced by an Active Payment Terminal Vendor SKU to Inactive is **allowed**; the referencing row surfaces each component's live `status` (via the resolved `adaptors` / `usb_cables` arrays) so the UI can flag a now-Inactive component.
- The link table (`sku_vendor_links`) is internal and never surfaced on `GET /vendor-skus*`. The Manage Vendor SKU screen does **not** render a "Linked Innoviti SKUs" column.

#### UI surface
- **Manage Vendor SKU** screen. Each row is one Vendor SKU. Columns: Vendor, SKU Type, Vendor SKU Number, Vendor SKU Name, MOQ, Unit price, **Adapters / Cables** (resolved component Vendor SKU numbers on Payment Terminal rows), Status, Spec PDF (View / Upload / Replace), Actions (Modify / Activate-Deactivate / Delete; Restore for soft-deleted rows). Filters: Vendor, SKU Type, Show deleted. **No** "Linked Innoviti SKUs" column.
- **Add Vendor SKU modal**: Vendor (required), SKU Type (required), Vendor SKU Number (required), Vendor SKU Name (optional), MOQ, Unit price. When the chosen **SKU Type is "Payment Terminal"**, the modal reveals two **required** multi-selects — **Adaptor Vendor SKUs** (filtered to Vendor SKUs of type `Adaptors`) and **USB-cable Vendor SKUs** (type `USB cables`). Other SKU Types hide them.
- **Modify Vendor SKU modal**: Vendor and SKU Type are shown disabled (immutable); number, name and price fields are editable, plus the adaptor / USB-cable multi-selects when the SKU Type is Payment Terminal.

#### Cross-object dependencies
- Vendors and SKU Types must exist.

#### Acceptance
- Creating a Vendor SKU without `sku_type_id` returns 422.
- Two Vendor SKUs of the same vendor cannot share a vendor SKU number; same number under a different vendor is accepted.
- A PATCH that attempts to change `vendor_id` or `sku_type_id` returns 422.
- DELETE on any Vendor SKU succeeds with a soft delete; any non-deleted `sku_vendor_links` rows referencing it are soft-deleted in the same transaction (no 409 surfaced).
- `GET /vendor-skus/{id}` response carries vendor name and SKU Type name but no `linked_skus` array.
- Creating a Payment Terminal Vendor SKU with no adaptor or USB-cable selection (or when none exist to pick) returns 422 with a "create the prerequisite Vendor SKU first" / "pick at least one" message.
- Creating a Payment Terminal Vendor SKU referencing a Vendor SKU that is not of type `Adaptors` (resp. `USB cables`) returns 422.
- `GET /vendor-skus` and `GET /vendor-skus/{id}` resolve `adaptor_vendor_sku_ids` / `usb_cable_vendor_sku_ids` into `adaptors` / `usb_cables` arrays of `{ vendor_sku_id, vendor_sku_number, vendor_sku_name, status }`.

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
- *(No Principal/Secondary contact fields are used.* The Location ↔ Contact association now lives on the Contact (`contacts.location_id`, §4); a Location's contacts are a read-only derived list — see below. The legacy `principal_contact_id` / `secondary_contact_id` / `owner_type` columns physically remain in the schema but are unused by the application — they are deliberately **not** dropped because an earlier idempotent migration re-runs against them on every boot.)*
- `created_at`, `updated_at`, `deleted_at` (timestamps).

**Derived (not columns on `locations`)**:
- `assigned_user_ids` — every `users.user_id` where `users.location_id = <this location_id> AND users.deleted_at IS NULL` (any location-eligible type). Surfaced read-only in API responses. **Set on the User form** (`POST`/`PATCH /users`, §3), not from any Location endpoint.
- `assigned_aso_user_ids` / `assigned_stu_user_ids` — the same projection narrowed to `user_type_code = 'ASO'` / `'STU'`; surfaced for the Phase 3 audit modules. Read-only here.
- `contact_ids` — every `contacts.contact_id` where `contacts.location_id = <this location_id>` (§4), surfaced read-only on the Location detail page (soft-deleted contacts shown with `(deleted)`).
- All projections derive from a single-FK column on the child row (`users.location_id` / `contacts.location_id`); a given user/contact appears under at most one Location.

**Seeded row.** A **Bangalore HO** Location owned by the Innoviti vendor is seeded at boot (cold-start default, §1.12). It carries Innoviti's head-office address; the seeded SA and the first Admin are tied to it via `users.location_id`. It cannot be soft-deleted while those default users still point at it.

**No Status field.** Soft delete is the only retirement mechanism.

### API endpoints
- `POST   /locations` — create (SA or Admin).
- `GET    /locations/{id}` — read one. Response includes an `assigned_users` array `[{ user_id, user_index, first_name, last_name, email, user_type_code }]` (plus the `assigned_aso_users` / `assigned_stu_users` narrowed subsets for Phase 3), and a `contacts` array `[{ contact_id, contact_index, first_name, last_name, email, deleted }]` derived from `contacts.location_id`. All are **read-only** — assignment happens on the child (User / Contact) forms.
- `GET    /locations` — list, filterable by `vendor_id`.
- `PATCH  /locations/{id}` — update name / address; updates to `vendor_id` are **SA only**. The Location has **no contact or user assignment fields** — those associations live on the child objects (Contact `location_id`, User `location_id`). Changing a Location's `vendor_id` does not touch the Contacts/Users that point at it (their references persist; a Contact whose own vendor no longer matches is flagged "(other vendor)" on the Contact form, §4).
- *(Removed: `PUT /locations/{id}/aso-users` and `PUT /locations/{id}/stu-users`.* ASO/STU location assignment now happens on the User Create/Modify form (§3); the per-user Innoviti-vendor gate and the Phase 3 in-flight-audit guard moved to `POST` / `PATCH /users`. Each such User write emits its own `(User, <user_index>, actor, Create|Update)` change-log row as usual.)*
- `DELETE /locations/{id}` — **soft delete**. Blocked with 409 `location_has_assigned_users` if any non-deleted User still has `location_id` pointing here — re-point or clear those users first by editing them (§3). Contacts that reference the Location do **not** block the delete; they retain their `location_id` and render the Location with `(deleted)`.

### Validation rules
- `location_name`: required; **no uniqueness constraint** — duplicates within or across vendors are allowed.
- `vendor_id`: at create, any Vendor (Active or Inactive — see §6). On update, mutable **only by SA**; the change does not clear or rewrite the Contacts/Users that reference this Location.
- A Location has **no contact or user fields** to validate — those associations are validated on the child objects: Contact ↔ Location in §4 (same-vendor rule), and User ↔ Location in §3 (location-eligible type, vendor-match rule, Phase 3 in-flight guard). The error codes `user_vendor_mismatch` and `audit_location_in_use` / `store_location_in_use` are now raised by the User write endpoints.

### Business rules / invariants
- **Deleted contacts retained in display**: a Contact tied to this Location (via `contacts.location_id`) continues to render on the Location detail page's "Contacts at this location" list even after Contact soft-delete, with the `(deleted)` suffix.
- **Vendor change does not rewrite children**: when SA changes a Location's `vendor_id`, the Users and Contacts that reference this Location keep their references. A Contact whose own `vendor_id` no longer matches is flagged "(other vendor)" on the Contact form (§4).
- Soft-deleted Locations remain referenced by historical inventory records (when those modules ship in later phases).

### UI surface
- **Manage Locations** screen with Vendor filter.
- **Add / Modify Location form**: vendor picker (disabled on edit for non-SA roles), location name, address with pincode lookup. **No contact or user pickers** — Contacts and Users attach themselves to a Location from their own forms (§4, §3).
- **Location detail page** shows two read-only derived panels: **"Contacts at this location"** (Contacts whose `location_id` matches, `(deleted)`-suffixed where soft-deleted) and **"Assigned users"** (Users whose `location_id` matches, with their user-type). Each entry deep-links to the child object's detail/modify page, which is where the association can be changed.

### Cross-object dependencies
- Vendor must exist.
- Contacts are **no longer** a precondition — a Location is created against its Vendor alone, then Users and Contacts attach to it afterward (§1.12 creation order: Locations precede Users and Contacts).

### Acceptance
- Creating a Location requires only a Vendor + name + address — no contact is required (the old Principal-contact requirement is gone).
- A non-SA user attempting to PATCH `vendor_id` on a Location is rejected (403).
- Two Locations with the same name under the same Vendor (or across different Vendors) are both accepted — `location_name` has no uniqueness constraint.
- The Location detail page's "Contacts at this location" list reflects exactly the Contacts whose `location_id` points here; a soft-deleted such Contact still appears with `(deleted)`.
- The "Assigned users" list reflects exactly the Users whose `location_id` points here; assignment is changed from the User form (§3), not here.
- Soft-deleting a Location that still has assigned Users returns 409 `location_has_assigned_users`; re-pointing those users elsewhere (or clearing their `location_id`) on the User form allows the delete to succeed. Referencing Contacts do not block the delete.

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
