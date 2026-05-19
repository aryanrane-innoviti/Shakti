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
- `POST /auth/password-reset/request` — SA/Admin-initiated; generates single-use token tied to a target user.
- `POST /auth/password-reset/consume` — target user submits token + new password.
- `GET  /auth/password-reset/url/{user_id}` — returns the reset URL string for **copy-to-clipboard** by SA/Admin (no automated email is sent).

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

### 1.10 Change log (see §11)
Every Section 1 object writes a **minimal** change-log entry on create/update/delete/status-toggle/upload (see Work Package 11 for the reduced schema and endpoints). The log captures only: object, actor, action, timestamp — no per-field old→new diff.

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
- **Manage User Types** screen (SA only): list of all types with inline rename for non-immutable rows, plus an "Add User Type" button.

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
- `address_line_1` (string).
- `address_line_2` (string, optional).
- `pincode` (string, 6 digits).
- `city` (string, derived from pincode at form-fill).
- `state` (string, derived from pincode at form-fill).
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
- **Add User / Modify User form**: all fields above, with pincode lookup, vendor picker (defaults to Innoviti for non-RLU/LOU and remains editable), conditional Employee ID field shown only when vendor is Innoviti.
- **Confirm-via-popup** for Modify and Delete actions.

### Cross-object dependencies
- User Types must exist (seeded).
- Vendors must exist (Innoviti seed at minimum).

### Acceptance
- SA's first login lands on Initial Setup and cannot navigate elsewhere until an Admin is created.
- Creating a non-Innoviti user without Employee ID succeeds; creating an Innoviti user without Employee ID returns 422.
- Two users cannot share the same email.
- Deleting a user sets Status=Inactive; the user appears in historical reports but is denied login.
- Reactivating an Inactive user triggers a password reset email/token.

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
- `Contact_Link` (refers to the contacts associated).
- `created_at`, `updated_at`, `deleted_at` (timestamps).


### Seeded rows
- One **Innoviti** vendor seeded at boot. Its `gst_number` may be null. It cannot be soft-deleted while any user/contact/location/SKU references it (which is always).

### API endpoints
- `POST   /vendors` — create (SA or Admin).
- `GET    /vendors/{id}` — read one. Response includes a `contact_persons_url` for the hyperlinked Contacts view.
- `GET    /vendors/{id}/contacts` — list all Contacts whose `vendor_id` matches.
- `GET    /vendors` — list, filterable by `status`, `vendor_type_id`.
- `PATCH  /vendors/{id}` — update.
- `DELETE /vendors/{id}` — **soft delete**, but **blocked** with 409 if any dependent record exists (Contacts, Users, Inventory Locations, primary or association-row SKU references). SA must toggle Status=Inactive instead.
- `POST   /vendors/{id}/status` — toggle Active/Inactive (SA or Admin).

### Validation rules
- `company_name`: required.
- `gst_number`: **required AND unique** for every vendor **except** the seeded Innoviti vendor (where it may be null). Must match the GSTIN regex.
- `vendor_type_id`: must reference an existing (non-deleted) Vendor Type.
- Registered office and operational address are independent fields — both pincode lookups happen separately.
- `status` can be changed only by SA or Admin.

### Business rules / invariants
- The seeded Innoviti vendor cannot be hard-deleted under any condition.
- **Inactive vendors remain visible in every picker** (Users vendor dropdown, Contacts vendor dropdown, Locations vendor dropdown, SKU association dropdown) and on every detail page, **annotated with an "(Inactive)" badge** next to the company name. They can still be selected for new associations; the badge is the only signal of their status.
- Hard delete is **never** offered; the DELETE endpoint performs soft delete only when no dependents exist, otherwise responds 409.

### UI surface
- **Manage Vendors** screen with filter chips for Status and Vendor Type.
- **Add / Modify Vendor form**: company info, vendor type picker, GST field (hidden / not required for the Innoviti default row only), the registered-office sub-address block visually separated from the operational address block, status toggle.
- **Vendor detail page**: header with company info; a **Contact Persons** hyperlink that navigates to a list of Contacts whose `vendor_id` matches; lists of associated Users, Locations, and SKUs.

### Cross-object dependencies
- Vendor Types must exist.

### Acceptance
- Creating a non-Innoviti vendor without GST returns 422.
- DELETE on a vendor that has any Contact / User / Location / SKU reference returns 409 with the dependency list.
- An Inactive vendor still appears on the User detail page of a user previously tagged to it.
- Clicking the Contact Persons hyperlink lists exactly the Contacts whose `vendor_id` matches.

---

## 7. SKU Types

### Fields & types
- `sku_type_id` (auto, internal).
- `name` (string, **required**, unique, 1–60 chars).
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
- Adaptor / USB / Parent SKU pickers on Payment Terminal SKUs rely on the existence of SKU Types literally named `Adaptors` and `USB cables`, plus the Terminal Parent SKU object. If a Payment Terminal SKU is created with no candidate Adaptor/USB/Parent SKU rows present, the save is blocked (see SKU §8).

### UI surface
- **Manage SKU Types** screen under Admin's "Modify Object Types" tab: list with inline rename and a **read-only** `serial_eligible` indicator. "Add SKU Type" button. The `serial_eligible` flag is set only on the Add form and cannot be toggled on existing rows. **No delete affordance is rendered** — SKU types are permanent.

### Cross-object dependencies
- None upstream.

### Acceptance
- Creating an SKU of a type whose `serial_eligible` is false with STM=Serial returns 422.
- Payment Terminal SKUs will always be thtough Serial Number.
- A soft-deleted SKU Type no longer appears in the SKU creation picker, but existing SKUs of that type still load.

---

## 8. SKU 

### 8.1 Innoviti SKU 

#### Fields & types
- `sku_number` (string, auto, format `INN-NNNNN` starting at `INN-10001`).
- `sku_name` (string, **required**, 1–100 chars).
- `description` (string, free text).
- `stm` (enum: `Serial`, `None`, **required**).
- `sku_type_id` (FK → SKU Types, **required**, **immutable after creation**).
- `specifications_pdf` (file ref → object storage; PDF, **≤10 MB**; **latest version only** — a new upload overwrites the previous file).
- `approx_price_moq` (integer ≥1) and `approx_price_unit` (decimal, ≥0) — together represent Approximate price per unit (MOQ + unit price).
- `status` (enum: `Active`, `Inactive`; default `Active`).
- **Conditional, only when `sku_type_id` resolves to "Payment Terminal":**
  - `adaptor_sku_ids` (array of FK → SKU where type=Adaptors, **required, non-empty**, multi-select).
  - `usb_cable_sku_ids` (array of FK → SKU where type=USB cables, **required, non-empty**, multi-select).
  - `parent_sku_id` (FK → Terminal Parent SKU, **required**).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

#### API endpoints
- `POST   /skus` — create (SA or Admin).
- `GET    /skus/{id}` — read one (includes association list).
- `GET    /skus` — list, filterable by `sku_type_id`, `status`, `vendor_id` (matches primary OR any association).
- `PATCH  /skus/{id}` — update; `sku_type_id` is rejected if changed.
- `DELETE /skus/{id}` — **soft delete** (sets `status = Inactive` and `deleted_at`).
- `POST   /skus/{id}/status` — toggle Active/Inactive (SA or Admin).
- `POST   /skus/{id}/specifications` — upload a new specifications PDF (≤10 MB). **Overwrites** the existing file; previous file is not retained.

#### Validation rules
- `sku_type_id`: required at create, **immutable on update**. Attempting to change returns 422.
- `stm` is **fully determined by the SKU type**:
  - If the SKU Type's `serial_eligible` is **true** (Payment Terminal, Base Station, SIM Card, or any custom serial-eligible type), `stm` **must be `Serial`** — `None` is rejected with 422.
  - If `serial_eligible` is **false**, `stm` must be `None` — `Serial` is rejected with 422.
  - The UI locks the STM dropdown the moment a type is picked and auto-sets the correct value, so the field can never be wrong from the form.
- `specifications_pdf`: MIME must be `application/pdf`; size ≤ **10 MB**.
- Payment Terminal save **fails with 422** if any of `adaptor_sku_ids`, `usb_cable_sku_ids`, `parent_sku_id` cannot be resolved to at least one candidate row (i.e., no Adaptor SKUs exist, no USB cable SKUs exist, or no Terminal Parent SKU exists). The error response instructs the user to create the prerequisite records first.

#### Business rules / invariants
- **SKU Type is immutable.** To change type, create a new SKU.
- **PDF storage**: object storage, **latest version only** (new uploads overwrite the previous file), **10 MB cap** per file.
- Setting an Adaptor / USB / Parent SKU referenced by an Active Payment Terminal SKU to Inactive is **allowed**, but:
  - The deactivation flow shows a warning listing the dependent Payment Terminal SKUs.
  - The dependent Payment Terminal SKU's detail page **highlights the stale reference in red**.
- Soft delete is reversible by toggling Status back to Active (subject to the standard role gating).

#### UI surface
- **Manage SKUs** screen with filters for Type, Status, Vendor.
- **Add / Modify SKU form** — Payment Terminal type **reveals** the Adaptor / USB / Parent multi-select widgets; other types hide them.
- **Vendor SKU pop-up modal inside SKU View** — shows the full grid of vendor-SKU associations (all peers; no primary distinction) for the Innoviti SKU, status toggle, dependent-reference warnings highlighted in red.


#### Cross-object dependencies
- SKU Types, Vendors, Terminal Parent SKU (for Payment Terminal types only).

#### Acceptance
- Creating a Payment Terminal SKU with no existing Adaptor SKU returns 422 with a clear "create Adaptor SKU first" message.
- PATCH that attempts to change `sku_type_id` returns 422.
- A 15 MB (or any >10 MB) PDF upload is rejected.
- Setting an Adaptor SKU to Inactive shows a warning enumerating dependent Payment Terminal SKUs; on confirm, the dependent Payment Terminal SKU page renders the Adaptor reference in red.
- Toggling Parent SKU type is not allowed.

### 8.2 : EMPTY

### 8.3 Vendor SKU (SKU↔Vendor association)

#### Fields & types
- `sku_vendor_assoc_id` (auto, internal).
- `sku_id` (FK → Innoviti SKU, **required**).
- `vendor_id` (FK → Vendors, **required**; the Vendor may be Active or Inactive — Inactive vendors remain selectable, see §6).
- `vendor_sku_number` (string, **required**) — the vendor's own part number.
- `vendor_sku_specification_pdf` (file ref → object storage; PDF, **≤10 MB**; **latest version only**).
- `vendor_sku_price_moq` (integer ≥1).
- `vendor_sku_price_unit` (decimal, ≥0).
- `created_at`, `updated_at`, `deleted_at` (timestamps).

**No `is_primary` flag.** All supplier rows are peers; there is no "primary supplier" concept. An SKU may have one or many supplier rows, and none of them is privileged over the others.

#### API endpoints
- `POST   /skus/{sku_id}/vendors` — add a supplier row.
- `GET    /skus/{sku_id}/vendors` — list all supplier rows (insertion order).
- `PATCH  /skus/{sku_id}/vendors/{assoc_id}` — update vendor SKU number / price / spec PDF.
- `DELETE /skus/{sku_id}/vendors/{assoc_id}` — **soft delete** an association row. No "primary" guard.
- `POST   /skus/{sku_id}/vendors/{assoc_id}/specification` — upload (overwrite) the vendor's spec PDF.

#### Validation rules
- `vendor_sku_specification_pdf`: PDF MIME; ≤10 MB; new uploads overwrite the prior file.
- `(sku_id, vendor_id, vendor_sku_number)`: unique across non-deleted rows — the same vendor cannot register the same part number twice against the same SKU.

#### Business rules / invariants
- An SKU must have **at least one** supplier row to be considered fully defined (UI surfaces this as a warning if zero supplier rows exist, but the API does not enforce it).
- Deleting the last supplier row leaves the SKU with zero suppliers; this is allowed but flagged on the SKU detail page.

#### UI surface
- **Manage Vendor SKU** screen lists every (Innoviti SKU × Vendor) association row with vendor SKU number, price, and the spec PDF link.
- **Add / Modify Vendor SKU form**: Add, Modify, and Delete supplier rows. No "set as primary" affordance.

#### Cross-object dependencies
- Innoviti SKU and Vendors must exist.

#### Acceptance
- An SKU may have zero, one, or many supplier rows; no row is marked "primary."
- DELETE on any supplier row succeeds (soft delete) without primary-related rejections.
- The same vendor adding two rows for the same SKU with **different** vendor SKU numbers is allowed; same vendor SKU number on a second row for the same (SKU, Vendor) pair is rejected.

---

## 9. Terminal Parent SKU

### Fields & types
- `parent_sku_number` (string, auto, format `PNN-NNNNN` starting at `PNN-10001`).
- `name` (string, **required**, 1–100 chars).
- `description` (string, free text).
- `created_at`, `updated_at`, `deleted_at` (timestamps; `deleted_at` always null — see delete rule).

**No Status field.**

### API endpoints
- `POST   /terminal-parent-skus` — create (SA or Admin).
- `GET    /terminal-parent-skus/{id}` — read one.
- `GET    /terminal-parent-skus` — list.
- `PATCH  /terminal-parent-skus/{id}` — update name/description.
- `DELETE /terminal-parent-skus/{id}` — **hard delete when unreferenced**; 409 Conflict (with the dependent SKU list in the response) if any SKU — including soft-deleted SKUs — references this Parent SKU.

### Validation rules
- `name`: unique (case-insensitive).
- Delete precondition: zero SKUs reference this Terminal Parent SKU (counts both Active and Inactive SKUs since their `parent_sku_id` is preserved).

### Business rules / invariants
- No Status concept.

### UI surface
- **Manage Terminal Parent SKUs** screen with create / edit.

### Cross-object dependencies
- None upstream. Required for Payment Terminal SKU creation.

### Acceptance
- Creating a Payment Terminal SKU is impossible until at least one Terminal Parent SKU exists.
- Deleting a Terminal Parent SKU referenced by any SKU returns 409.
- After deleting all referencing SKUs (soft), the Terminal Parent SKU is still blocked from delete because soft-deleted SKUs retain `parent_sku_id` — to physically free the Terminal Parent SKU, the dependent SKUs must be hard-purged (not supported in this phase). Document this as expected behavior.

> AMBIGUITY: The 35-question audit resolved the Terminal Parent SKU delete rule as "block hard delete when any SKU references it." Because Section 1 SKUs use soft delete (which retains `parent_sku_id`), in practice a Terminal Parent SKU referenced even once becomes effectively un-hard-deletable for the lifetime of this phase. This is consistent with the resolved decision and is documented as expected; no code change is requested, only flagging for product awareness.

---

## 10. Inventory Locations

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

**No Status field.** Soft delete is the only retirement mechanism.

### API endpoints
- `POST   /locations` — create (SA or Admin).
- `GET    /locations/{id}` — read one. Response includes resolved Principal/Secondary contact display names (with `(deleted)` suffix when contact is soft-deleted).
- `GET    /locations` — list, filterable by `vendor_id`.
- `PATCH  /locations/{id}` — update; updates to `vendor_id` are **SA only**. Existing Principal/Secondary contacts are **kept as-is** across the vendor change (no clearing, no re-pick prompt). The cross-vendor contact reference is allowed and persists until SA explicitly edits the contact pickers.
- `DELETE /locations/{id}` — **soft delete**.

### Validation rules
- `location_name`: required; **no uniqueness constraint** — duplicates within or across vendors are allowed.
- `principal_contact_id`: required; **at the moment of assignment** (create, or whenever the contact picker is edited), the chosen Contact must be non-deleted and have `vendor_id` equal to the Location's current `vendor_id`. After a subsequent vendor change on the Location, the existing principal reference is preserved even if it no longer matches the new vendor.
- `secondary_contact_id`: if provided, same vendor rule **at the moment of assignment**, and must not equal `principal_contact_id`.
- `vendor_id`: at create, any Vendor (Active or Inactive — see §6). On update, mutable **only by SA**; contact references are not cleared on the change.

### Business rules / invariants
- **Deleted contacts retained in display**: a Contact that was Principal or Secondary on this Location continues to render on the Location form even after Contact soft-delete, with the `(deleted)` suffix.
- **Vendor change does not clear contacts**: when SA changes a Location's `vendor_id`, the existing `principal_contact_id` and `secondary_contact_id` references are preserved as-is, even if those contacts now belong to a different Vendor. The Location form continues to render those contacts; SA may edit the pickers later if desired.
- Soft-deleted Locations remain referenced by historical inventory records (when those modules ship in later phases).

### UI surface
- **Manage Locations** screen with Vendor filter.
- **Add / Modify Location form**: vendor picker (disabled on edit for non-SA roles), location name, address with pincode lookup, Principal and Secondary contact pickers scoped to the chosen Vendor's Contacts list. When SA changes the vendor on an existing Location, the contact pickers display the previously selected (possibly cross-vendor) contacts; the dropdowns themselves still list only the new Vendor's contacts for fresh selection. A small "(other vendor)" annotation appears next to a contact name whose vendor no longer matches the Location's vendor.
- If the chosen Vendor has zero non-deleted Contacts, the Principal-contact picker shows an inline message — "No contacts exist for this Vendor — add a contact first" — and the form blocks submission until a Contact is created.

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

---

## 11. Change Log (cross-cutting, minimal)

A single change-log facility records **one row per mutation** on every Section 1 object. The log is intentionally minimal: it answers "who did what, to which object, when" — not "which field changed from X to Y." Per-field diff history is **out of scope**.

### Fields & types
- `change_log_id` (auto, internal).
- `object_type` (enum: `User`, `UserType`, `Contact`, `Vendor`, `VendorType`, `SKU`, `SKUType`, `SKUVendorAssociation`, `TerminalParentSKU`, `Location`).
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
- Soft delete → `action = SoftDelete`. Hard delete (Vendor Types when unused, Terminal Parent SKU when unreferenced) → `action = HardDelete`.
- Status toggles (`Active`/`Inactive`) on Users, Vendors, SKUs → `action = StatusToggle`.
- PDF uploads (SKU spec, Vendor-SKU spec) → `action = Upload`.

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
- Audit module, including the user-level Locked Audit Location field and any audit workflow constraints.
- Order generation, partial-shipment splitting, and split-order numbering rules.
- Dispatch and retrieval flows.
- MIS reporting and report builders.
- Load Data journeys (`_Load_data_requirements.txt`).
- Master records derived from Load Data — Payment Terminal Master, SIM Card Master, Accessories Master, Load Stock.
- Inventory state machine (in-transit vs at-location) — modeled in a later phase when orders/dispatch ship.
- Operational user-type access to any Section 1 object — operational types exist but have no permissions in this phase.
