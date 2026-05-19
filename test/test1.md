# Shakti 2.0 — Test Specification (Section 0 & Section 1)

## How to read this document
This is a stack-agnostic test plan for the Shakti supply-chain management system, covering Foundations (Section 0) and Object Creation (Section 1) only. Cases are derived from `_obj_req.txt`, `_Design_Constraints_09_May.txt`, and 35 resolved product decisions. Future-phase flows (orders, dispatch, retrieval, audit workflow, MIS, Load Data, master records) are dropped entirely. Each bullet states a concrete input and an expected outcome in Given/When/Then or assertion style; no framework syntax.

## 1. Cross-cutting / Foundations

### Authentication (pre-SSO)
- Given a fresh deployment, When the system boots, Then a Super Admin account exists seeded from the config secret with the configured hardcoded password and no other user records exist.
- Given the seed config secret is rotated, When the deploy is re-run, Then the SA password reflects the new secret and the old password is rejected at login.
- Given SA logs in for the first time, When SA attempts to navigate to any tab other than "Register Admin", Then navigation is blocked and the user is redirected to the Register Admin screen.
- Given SA has not yet registered an Admin, When SA tries to call any non-Admin-creation API, Then the request is rejected with an authorization error.
- Given SA has registered the first Admin, When SA navigates anywhere in the app, Then all SA-permitted tabs become accessible.
- Given a non-SA actor, When they attempt the SA-only "create first Admin" endpoint, Then the call is rejected.
- Given correct SA credentials, When SA logs in, Then a session is established; Given wrong credentials three times, Then the response remains the same generic failure (no user-existence leak).

### Password Reset URL
- Given Admin/SA clicks "Copy Password Reset URL" on a user row, When the click resolves, Then a single-use token URL with a 24h expiry is generated and placed on the clipboard; no email is sent.
- Given a freshly generated reset URL, When the user opens it and sets a new password, Then the URL is consumed and a second visit returns "link already used".
- Given a reset URL older than 24 hours, When the user opens it, Then the response is "link expired" and the password is unchanged.
- Given a reset URL is generated and unused, When a second reset URL is generated for the same user, Then the **first URL is invalidated** — opening it returns "link invalid"; only the most recently issued URL is consumable.
- Given correct credentials but the user's status is Inactive, When login is attempted, Then login is rejected with the same generic message as wrong credentials (no status leak).

### Deferred UI (Google SSO, audit-report review)
- Given any logged-in user, When the navigation renders, Then **no** "Sign in with Google" entry is present (deferred features are hidden entirely, not greyed out).
- Given Admin's dashboard, When it renders, Then **no** "Audit Report Review" entry is present.
- Given a client calls the Google SSO or audit-report-review backend route, When the request hits the server, Then a 404/route-not-found is returned (no backend exists yet).

### Backups
- Given the daily backup job runs, When it completes, Then a snapshot file tagged with a UTC timestamp is produced in the backup store.
- Given SA clicks the "Backup" button in the UI, When prompted, SA enters a filename and confirms, Then a snapshot is captured under that filename in the backup store.
- Given SA clicks the "Restore" button, When SA picks a backup file from the list and confirms the overwrite warning, Then the main database is replaced with the snapshot's contents.
- Given the main application process, When it tries to read the backup store directly, Then access is denied (isolation asserted).
- Given a corrupted main DB, When the backup is restored into a parallel environment, Then all Section-1 object data is recovered with timestamps intact.
- Given a backup snapshot, When inspected, Then it contains user password hashes, API keys, and any stored credentials so that restore yields a fully functional system with no manual secret re-provisioning.

### Concurrency
- Given 30 concurrent authenticated sessions, When each performs typical Section-1 reads and writes, Then no request fails due to user-count limits and response times stay within agreed soft target.
- Given a 31st concurrent user, When they attempt to log in, Then login succeeds (no enforcement at #31; soft target only).

### Soft delete model (referenced by all object sections)
- Given any Section-1 object is "deleted" via UI or API, When the operation completes, Then the row persists with `deleted_at` populated and is excluded from default list endpoints.
- Given a soft-deleted object, When queried with an explicit "include deleted" flag (SA-only), Then the row is returned with its `deleted_at` timestamp.
- Given a soft-deleted object, When a non-SA user lists the object, Then it does not appear.

### Pincode → City/State derivation
- Given a valid 6-digit Indian pincode is entered in any address form, When the field loses focus, Then City and State are populated from the third-party API and are read-only.
- Given a pincode that resolves to multiple cities, When the field loses focus, Then a dropdown is presented for the user to pick the correct city; once picked, State is derived accordingly.
- Given an invalid pincode, When the field loses focus, Then City/State remain blank, a "could not resolve pincode" message is shown, and the form **cannot be submitted**.
- Given the third-party pincode API is unreachable, When the field loses focus, Then a retry affordance is shown and the form **blocks submission** until City/State are successfully resolved.

### API-first parity (applies to every mutation in every object section)
- For every Section-1 create/update/soft-delete reachable from the UI, an equivalent REST endpoint exists and produces an identical post-state when invoked with the same payload (verified per object in sections 2–10).
- Given identical inputs are sent via UI and via API for the same object, When both complete, Then the resulting database row is field-for-field equal (excluding auto IDs and timestamps).

### Branding & Typography
- Given any rendered page, When inspected, Then the active font family is Raleway Light and the palette uses Purple, Orange, and Grey only.
- Given a UI element claims to be a primary action, When rendered, Then it uses the Purple or Orange brand token, not an arbitrary color.

### Responsive design
- Given viewport ≥ 768px, When any form renders, Then two-column layouts display side-by-side.
- Given viewport = 640px, When a two-column form renders, Then it collapses to a single column.
- Given viewport = 480px, When the main nav renders, Then it adapts to a mobile drawer/hamburger pattern.
- Given any form input on iOS Safari, When focused, Then font-size is ≥16px and the viewport does not auto-zoom.
- Given a data table wider than its card, When rendered on a narrow viewport, Then the table scrolls horizontally inside the card and respects min-width 480px.
- Given filter tabs exceed one row width, When rendered, Then they wrap to multiple rows rather than clipping.

### Browser / OS matrix
- The above Foundations cases pass on Chrome, Safari, and Bing browsers across macOS, Windows, Linux desktops and Android, iOS mobiles.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-1.1-01 | Open the web app in Chrome (Windows), Safari (macOS), and Edge (Windows) | App loads without browser-incompatibility errors |
| TC-1.1-02 | Open the web app in Chrome (Android) and Safari (iOS) | App loads with responsive mobile layout |
| TC-1.2-01 | Inspect text on login, dashboard, and form screens | Active font family is Raleway Light across all surfaces |
| TC-1.2-02 | Inspect primary actions, headers, and accent regions | Palette uses Purple and Orange as primary; Grey as accent only |
| TC-1.3-01 | Resize viewport to 480 px width | Layout collapses to single column; tables scroll horizontally; tab bars wrap |
| TC-1.3-02 | Tap a form input on iOS Safari | No auto-zoom; input font is ≥16 px |
| TC-1.3-03 | Render data table wider than card on narrow viewport | Table scrolls horizontally inside card; min-width 480 px respected |
| TC-1.4-01 | Boot a fresh install; log in with seeded SA credentials | SA login succeeds and lands on Register-Admin screen |
| TC-1.4-02 | `POST /auth/login` with non-existent username | HTTP 401 with body "Invalid credentials" |
| TC-1.4-03 | `POST /auth/login` with valid username + wrong password | Response byte-identical to TC-1.4-02 |
| TC-1.4-04 | Issue reset URL #1, then issue reset URL #2 for same user, then consume URL #1 | URL #1 returns "link invalid"; URL #2 still works |
| TC-1.4-05 | Consume reset URL >24h after issuance | Token expired error |
| TC-1.4-06 | Consume same reset URL twice | First consume succeeds; second fails |
| TC-1.4-07 | Inactive user attempts login | HTTP 401 with generic "Invalid credentials" |
| TC-1.4-08 | Inspect navigation chrome | No "Sign in with Google"; no "Audit Report Review" |
| TC-1.4-09 | Call Google SSO or audit-report-review backend route | HTTP 404 (no backend exists yet) |
| TC-1.4-10 | SA tries to navigate elsewhere before creating first Admin | Redirected back to Register-Admin |
| TC-1.4-11 | Non-SA attempts the SA-only "create first Admin" endpoint | Rejected with authorization error |
| TC-1.5-01 | Perform every UI mutation; capture network traffic | Each maps to a documented REST endpoint returning JSON |
| TC-1.5-02 | Call any list endpoint without an auth session | HTTP 401 |
| TC-1.5-03 | Submit identical payload via UI and API for same object | Resulting DB row is field-for-field equal (excluding auto IDs/timestamps) |
| TC-1.6-01 | Drive 30 concurrent active sessions through Section-1 CRUD | No failures from user-count limits; response times within soft target |
| TC-1.6-02 | Open a 31st concurrent session | Login succeeds (no runtime cap) |
| TC-1.7-01 | Daily backup job runs to completion | Snapshot file is produced, tagged with UTC timestamp |
| TC-1.7-02 | SA clicks Backup and supplies file name | Snapshot captured under that filename in backup store |
| TC-1.7-03 | SA clicks Restore and confirms overwrite | Main DB replaced with snapshot contents |
| TC-1.7-04 | Main application process attempts to read backup store directly | Access denied (isolation) |
| TC-1.7-05 | Inspect backup snapshot contents | Contains password hashes, API keys, stored credentials |
| TC-1.8-01 | Soft-delete any object; call its default GET list | Object hidden from default list; retained with `deleted_at` |
| TC-1.8-02 | Query soft-deleted object with `include_deleted=true` (SA only) | Row returned with `deleted_at` populated |
| TC-1.9-01 | Enter valid 6-digit pincode in any address form | City/State populated from third-party lookup and read-only |
| TC-1.9-02 | Enter pincode that resolves to multiple cities | Dropdown presented; State derived from chosen city |
| TC-1.9-03 | Enter invalid pincode | City/State remain blank; error shown; form blocks submit |
| TC-1.9-04 | Third-party pincode API unreachable | Retry affordance shown; form blocks submission until resolved |
| TC-1.10-01 | Mutate any Section 1 object | Exactly one change-log row written (object, actor, action, timestamp); no per-field diff |
| TC-1.11-01 | Admin calls `POST /user-types` | HTTP 403 |
| TC-1.11-02 | Operational user (ASO/STU/ALU/RLU/FNU/LOU) hits any Section 1 endpoint | HTTP 403 |
| TC-1.1-03 | Open the web app in Bing (Edge-compatible) on Windows | App loads without browser-incompatibility errors |
| TC-1.1-04 | Open the web app on Linux desktop (Chrome) | App loads with desktop layout |
| TC-1.3-04 | Resize viewport to 768 px (tablet breakpoint) | Two-column layouts still side-by-side; layout adapts to tablet |
| TC-1.3-05 | Resize viewport to 640 px | Two-column form collapses to single column |
| TC-1.3-06 | Render filter tab bar wider than viewport at 480 px | Tabs wrap onto multiple lines (no clipping) |
| TC-1.5-04 | Call any list endpoint with paging params (e.g. `?page=2&page_size=20`) | Returns paginated response; subsequent pages addressable |
| TC-1.5-05 | Call any list endpoint with `?search=...` | Returns rows matching the search term |
| TC-1.5-06 | Call any list endpoint with `?sort=field:asc` or `:desc` | Returns rows sorted by the requested field/direction |
| TC-1.4-12 | Open the public login screen | Renders username + password inputs; no "Sign in with Google" button |
| TC-1.4-13 | Open a copied password-reset URL as an end user | Reset-consumption screen renders; new-password fields accept input; submission consumes the token |
| TC-1.4-14 | Click "Forgot password" link on login screen | Triggers SA/Admin-only reset workflow; end user does not self-reset |

## 2. User Types

### Happy path
- Given SA or Admin opens Manage User Types, When the page loads, Then SA, Admin, ASO, STU, ALU, RLU, FNU, LOU are listed (read access for both roles).
- Given SA creates a new user type "ASE", When submitted, Then it appears in the list and becomes selectable in the Add User picklist.
- Given an Admin attempts to create a new user type, When submitted, Then the request is rejected with 403.
- Given SA renames the label of an operational seed (e.g. "STU" → "Store User"), When submitted, Then the new label is shown everywhere; the underlying type identity is unchanged.
- Given an Admin attempts to rename a user type, When submitted, Then the request is rejected with 403.

### Field validation
- Type name required: blank submission rejected; "ASE" accepted.
- Type name uniqueness: duplicate of an existing label rejected; novel label accepted.

### Business rules / invariants
- SA type: edit attempt rejected; delete attempt rejected.
- Admin type: edit attempt rejected; delete attempt rejected.
- Operational seeds (ASO/STU/ALU/RLU/FNU/LOU): label edit accepted; delete attempt rejected.
- Newly created types (e.g. "ASE"): label edit accepted; delete attempt rejected (no type is deletable in this phase).
- Operational user types (ASO/STU/ALU/RLU/FNU/LOU): assigned user attempts to call any Section-1 object endpoint → rejected with authorization error.
- SA and Admin: can call Section-1 object endpoints (per their scope defined in sections 3–10).

### UI cases
- Manage User Types screen reachable from SA and Admin nav only; hidden for operational users.
- Each row shows a "Modify Label" affordance; immutable types (SA, Admin) show the affordance disabled with tooltip "System type — label fixed".
- No row exposes a Delete affordance.

### API parity
- Type creation, label update each have a REST endpoint producing identical state to the UI flow.

### Edge & boundary
- Label = 50-char string: accepted.
- Label = 51-char string: rejected.
- Label with unicode characters (e.g. Devanagari "अनिता") **rejected** — labels are ASCII letters/digits/space/hyphen only.
- Label with digits and hyphens (e.g. "Region-2"): accepted.
- Listing user types when only seeds exist: returns exactly the 8 seeds.

### Negative / security
- Operational user attempts to GET /user-types: rejected.
- Operational user attempts POST /user-types: rejected.

### Change log
- See Section 11 for change-log coverage applied to user-type create and label update.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-2-01 | List `/user-types` on fresh install | Returns 8 seeded types: SA, ADMIN, ASO, STU, ALU, RLU, FNU, LOU |
| TC-2-02 | SA `PATCH /user-types/{id}` to rename the `SA` type | HTTP 409 (immutable) |
| TC-2-03 | SA `PATCH /user-types/{id}` to rename `ASO` → "Area Service Officer" | HTTP 200; label updates; type id unchanged |
| TC-2-04 | Admin calls `POST /user-types` | HTTP 403 |
| TC-2-05 | Admin attempts label rename on any user type | HTTP 403 |
| TC-2-06 | Any role calls `DELETE /user-types/{id}` | Rejected — no delete endpoint exists |
| TC-2-07 | SA creates user type `code = "ASE"`, valid label | HTTP 201; appears in Add User picker |
| TC-2-08 | SA attempts to change `code` on any user type | HTTP 422 (immutable) |
| TC-2-09 | SA sends `label = "अनिता"` (Devanagari) | HTTP 422 (ASCII only) |
| TC-2-10 | SA sends `label = "Region-2"` | HTTP 201 |
| TC-2-11 | SA sends 51-character `label` | HTTP 422 |
| TC-2-12 | SA sends 50-character `label` | HTTP 201 |
| TC-2-13 | Operational user calls `GET /user-types` | HTTP 403 |
| TC-2-14 | Operational user assigned to a Section-1 endpoint | HTTP 403 |
| TC-2-15 | Inspect Manage User Types screen as Admin | Visible; SA and ADMIN rows show disabled Modify with tooltip; no Delete affordance on any row |

## 3. Users

### Happy path
- Given SA on first login, When SA fills the Register-Admin form with valid data, Then UIN 10001 is assigned, Admin is persisted, and SA is unblocked from other tabs.
- Given SA/Admin on Manage User, When Add User is clicked top-right and a valid form is submitted, Then the next UIN (auto-increment, 5-digit, starts at 10001) is assigned.
- Given two users created consecutively, When their UINs are inspected, Then the second is exactly +1 of the first.
- Given SA/Admin clicks Modify on a user, When mobile number is changed and confirmation pop-up is accepted, Then the row reflects the new mobile and a change-log row is written.
- Given SA/Admin clicks Delete on a user, When confirmation is accepted, Then the user's Status flips to Inactive and `deleted_at` is set (soft delete).

### Field validation
- First name: "Anita" accepted; blank rejected; "A" (1 char) accepted; 50-char string accepted; 51-char string rejected; "अनिता" rejected (ASCII letters/space/hyphen/apostrophe only); "Mary-Jane" accepted; "O'Neil" accepted; "John1" rejected.
- Last name: same rules as First name.
- Email: "anita@innoviti.com" accepted; blank rejected; "not-an-email" rejected; duplicate of any existing user's email (including soft-deleted) rejected; uniqueness asserted globally across active and inactive.
- Mobile: optional for all user types. Blank accepted. If provided: "9876543210" accepted; "1234567890" rejected (does not start 6–9); "98765" rejected (too short); "98765432109" rejected (11 digits); "+919876543210" rejected (no prefix allowed).
- Vendor: required; defaults to Innoviti for non-RLU/LOU types; editable to any other vendor; for RLU/LOU there is no default — must be picked.
- Employee ID when Vendor=Innoviti: "IC/0001" accepted; "INN/9999" accepted; "IC/00001" rejected (5 digits); "IC/001" rejected (3 digits); "XX/0001" rejected (wrong prefix); "ic/0001" rejected (case); blank rejected; duplicate of an existing Employee ID (active or inactive) rejected.
- Employee ID when Vendor≠Innoviti: blank accepted; any value entered is rejected (field must be empty when not Innoviti).
- Address Line 1 / Line 2: free text; Line 1 required, Line 2 optional.
- Pincode: 6-digit numeric required; City and State auto-derived (see Foundations).
- Status: defaults to Active on create; can be flipped Active↔Inactive bidirectionally by SA/Admin only.

### Business rules / invariants
- Inactive user attempts to log in: rejected.
- Inactive user appears in user list with Status=Inactive; their historical references (where applicable) remain intact (cross-ref Sections 8 and 10 for stock retention).
- Reactivating a previously Inactive user: **a fresh single-use 24h password-reset URL is issued automatically** and surfaced via the copy-to-clipboard action. The user must consume the URL to set a new password before they can log in; their prior credentials no longer work after reactivation.
- Adding "Cannot create another SA": attempting to create a User with `user_type=SA` is rejected (system enforces a single SA seat — the seeded one).
- Hard delete of a user: not supported via UI or API; only soft delete.
- Operational user types cannot create/read/update/delete any Section-1 object (cross-ref Section 2).

### UI cases
- SA first-login: any tab click other than Register-Admin is intercepted and the user is routed to the Register-Admin form.
- Manage User dashboard: total user count shown at top; each row shows User Type and inline Modify, Delete, Copy-Password-Reset-URL buttons; Add User button is top-right.
- Modify confirmation: pop-up "Save changes?" is shown before commit.
- Delete confirmation: pop-up "Mark user inactive?" is shown before commit.
- Employee ID field: visible and required only when Vendor=Innoviti; hidden otherwise.

### API parity
- POST /users, PATCH /users/{id}, DELETE /users/{id} (soft), and POST /users/{id}/password-reset-url each mirror their UI counterparts.

### Edge & boundary
- 30 users created in rapid succession: UINs are sequential with no gaps.
- Email with mixed case "Anita@Innoviti.com" vs "anita@innoviti.com": treated as duplicates (case-insensitive uniqueness).
- Employee ID format `IC/0000` (per spec example): accepted.

### Negative / security
- Operational user calls POST /users: rejected.
- Admin calls SA-only routes (e.g. create-first-Admin): rejected.
- A user attempts to set Status of another user without SA/Admin role: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-3-01 | SA logs in for the first time | Register-Admin screen shown; other navigation blocked |
| TC-3-02 | SA creates first Admin via Register-Admin | Admin persisted; UIN = `UIN-10001`; navigation unlocks |
| TC-3-03 | Create two users consecutively | Second UIN is exactly +1 of the first |
| TC-3-04 | Create user with `user_type = STU`, vendor ≠ Innoviti, no `employee_id` | HTTP 201 |
| TC-3-05 | Create user with vendor = Innoviti, no `employee_id` | HTTP 422 |
| TC-3-06 | Create user with vendor ≠ Innoviti, `employee_id = "IC/1234"` | HTTP 422 |
| TC-3-07 | Create user with `employee_id = "IC/0001"`, vendor = Innoviti | HTTP 201 |
| TC-3-08 | Create user with `employee_id = "ic/0001"`, vendor = Innoviti | HTTP 422 (case) |
| TC-3-09 | Create user with `employee_id = "IC/001"` | HTTP 422 (3 digits) |
| TC-3-10 | Create user with `employee_id = "IC/00001"` | HTTP 422 (5 digits) |
| TC-3-11 | Create user with `employee_id = "XX/0001"` | HTTP 422 (bad prefix) |
| TC-3-12 | Create two users with same email | Second create returns HTTP 422 |
| TC-3-13 | Create users with `"Anita@Innoviti.com"` then `"anita@innoviti.com"` | Second rejected (case-insensitive uniqueness) |
| TC-3-14 | Create user with `mobile = "5123456789"` | HTTP 422 (must start 6–9) |
| TC-3-15 | Create user with `mobile = "98765"` | HTTP 422 (too short) |
| TC-3-16 | Create user with `mobile = "+919876543210"` | HTTP 422 (no prefix) |
| TC-3-17 | Create user with no mobile | HTTP 201 |
| TC-3-18 | `first_name = "John1"` | HTTP 422 |
| TC-3-19 | `first_name = "O'Neil"` | HTTP 201 |
| TC-3-20 | `first_name = "Mary-Jane"` | HTTP 201 |
| TC-3-21 | `first_name = "अनिता"` | HTTP 422 |
| TC-3-22 | `DELETE /users/{id}` | Status flips to Inactive; `deleted_at` set; row retained |
| TC-3-23 | Inactive user attempts login | HTTP 401 (generic message) |
| TC-3-24 | Toggle Inactive user back to Active | Fresh single-use 24h reset URL issued; prior password no longer works |
| TC-3-25 | Hit `GET /users/dashboard/summary` | Returns total user count |
| TC-3-26 | Attempt to create a second SA via `POST /users` | HTTP 422 (single SA seat) |
| TC-3-27 | Attempt hard delete of any user | Not supported via UI or API |
| TC-3-28 | RLU/LOU user create without vendor | HTTP 422 (no Innoviti default) |
| TC-3-29 | Non-Innoviti user create with `employee_id` populated | HTTP 422 |
| TC-3-30 | Operational user calls `POST /users` | HTTP 403 |
| TC-3-31 | Admin calls SA-only "create first Admin" endpoint | HTTP 403 |
| TC-3-32 | Non-SA/Admin sets Status on another user | HTTP 403 |
| TC-3-33 | `GET /users?status=Inactive` | Returns only Inactive users |
| TC-3-34 | `GET /users?user_type_id={id}` | Returns only users of that type |
| TC-3-35 | `GET /users?vendor_id={id}` | Returns only users tagged to that vendor |
| TC-3-36 | Submit user create with empty `address_line_1` | HTTP 422 |
| TC-3-37 | Submit user create with empty `address_line_2` | HTTP 201 (optional) |
| TC-3-38 | Click Modify on a user row | Confirm-via-popup ("Save changes?") shown before commit |
| TC-3-39 | Click Delete on a user row | Confirm-via-popup ("Mark user inactive?") shown before commit |
| TC-3-40 | Submit pincode in user form | City/State auto-populate and persist on the user record |

## 4. Contacts

### Happy path
- Given Admin/SA selects a Vendor and submits a Contact create form, When valid, Then NIN (5-digit auto-increment from 10001) is assigned and the contact appears under the Vendor's "Contact Persons" hyperlink.
- Given an existing contact, When Modify is submitted with a valid change, Then the row updates and a change-log entry is written.
- Given a contact is soft-deleted, When the Vendor list is re-rendered, Then the contact no longer appears in the Vendor's contact picker for new selections.

### Field validation
- First name / Last name: same ASCII-letters/space/hyphen/apostrophe rules as Users (cross-ref Section 3); 1–50 chars; blank rejected.
- Email: required; **no uniqueness constraint** (two Contacts may share the same email); "ramesh@logistics.com" accepted; a second Contact submitted with the same email is also accepted; malformed addresses rejected.
- Mobile: optional (overrides spec which says compulsory); blank accepted; if provided, must satisfy `^[6-9]\d{9}$` (cross-ref Users mobile rule).
- Vendor: required (constraint: contact-requires-vendor); blank submission rejected.

### Business rules / invariants
- Constraint "A contact cannot be added unless a vendor is selected against them": create attempt with empty Vendor → rejected with explicit message.
- Soft-deleted contact remains visible in any Inventory Location where it was Principal or Secondary contact (cross-ref Section 10), shown with a "deleted" badge.
- Soft-deleted contact is excluded from the Vendor's Contact Persons picker for new Location creation/edit.

### UI cases
- Contact create form: Vendor field is the first required input; until Vendor is picked, all other fields are disabled.
- Vendor detail page: "Contact Persons" hyperlink lists every contact (active and inactive) whose Vendor = this vendor.
- Manage Contacts dashboard: total count at top; each row has Modify, Delete actions.

### API parity
- POST /contacts, PATCH /contacts/{id}, DELETE /contacts/{id} (soft) all mirror UI.

### Edge & boundary
- Contact with unicode name "Ramesh-Kumar": accepted only if all chars are ASCII letters/space/hyphen/apostrophe — same restriction as Users (cross-ref decision).
- Multiple contacts for the same Vendor: all appear under the Vendor's Contact Persons hyperlink.

### Negative / security
- Operational user calls POST /contacts: rejected.
- Attempt to assign Contact to a soft-deleted Vendor: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-4-01 | `POST /contacts` without `vendor_id` | HTTP 422 with explicit message |
| TC-4-02 | Create first Contact for a Vendor | `contact_index = NIN-10001` |
| TC-4-03 | Create two Contacts with the same email (same or different Vendors) | Both succeed (no uniqueness) |
| TC-4-04 | Create Contact with no `mobile` | HTTP 201 |
| TC-4-05 | Create Contact with `mobile = "1234567890"` | HTTP 422 (must start 6–9) |
| TC-4-06 | Create Contact with malformed email | HTTP 422 |
| TC-4-07 | `POST /contacts` referencing a soft-deleted Vendor | HTTP 422 |
| TC-4-08 | Soft-delete a Contact that is Principal on a Location | Contact still rendered on Location form with "deleted" badge |
| TC-4-09 | Open Contact picker for new Location after Contact soft-deleted | Soft-deleted Contact not present in picker |
| TC-4-10 | Click "Contact Persons" hyperlink on Vendor detail | Lists every contact (active and inactive) whose Vendor = this vendor |
| TC-4-11 | Modify a Contact field and submit | Row updates; one change-log entry written |
| TC-4-12 | Operational user calls `POST /contacts` | HTTP 403 |
| TC-4-13 | Contact create form before Vendor is picked | All other fields disabled |
| TC-4-14 | First-name with non-ASCII chars | HTTP 422 |
| TC-4-15 | `GET /contacts?include_deleted=true` | Response includes soft-deleted contacts |
| TC-4-16 | `GET /contacts?vendor_id={id}` | Returns only contacts whose `vendor_id` matches |

## 5. Vendor Types

### Happy path
- Given Admin/SA opens Manage Vendor Types, When the page loads, Then Logistics Vendors, SKU Vendors, Service Vendors, Merchant, Innoviti are listed.
- Given Admin/SA creates a new Vendor Type "Calibration Vendor", When submitted, Then it appears in the Vendor Type picklist.
- Given a Vendor Type with no referencing Vendors, When Delete is clicked, Then the type is hard-deleted and disappears from the picklist.

### Field validation
- Type name required; 1–50 chars; uniqueness enforced.

### Business rules / invariants
- **Vendor Type names are immutable after creation** — no rename affordance exists in the UI; any PATCH attempt on `name` is rejected (405/404, no PATCH endpoint).
- Delete attempt on a Vendor Type referenced by ≥1 Vendor (e.g. Innoviti referenced by the default Innoviti Vendor): rejected with message naming the referencing vendors.
- Innoviti type: deletable only when unused; in a fresh deployment with the seeded Innoviti Vendor present, Innoviti type deletion is rejected.

### UI cases
- Each row shows only a Delete affordance; Delete is greyed-out with tooltip when the type is in use. **No Modify/rename button** is rendered.

### API parity
- POST /vendor-types, DELETE /vendor-types/{id} mirror UI. **No PATCH endpoint** is exposed for Vendor Types.

### Edge & boundary
- Delete of the last unused Vendor Type: succeeds and the picklist updates immediately.
- Attempt to create a type with whitespace-only name: rejected.

### Negative / security
- Operational user calls any /vendor-types endpoint: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-5-01 | List `/vendor-types` on fresh install | Returns 5 seeded types: Logistics Vendors, SKU Vendors, Service Vendors, Merchant, Innoviti |
| TC-5-02 | Issue `PATCH /vendor-types/{id}` on any type | HTTP 405 / 404 (no PATCH route) |
| TC-5-03 | `DELETE /vendor-types/{id}` for `Innoviti` while seeded Innoviti vendor exists | HTTP 409 with referencing-vendor names |
| TC-5-04 | Create new Vendor Type `"Calibration Vendor"` | HTTP 201; appears in picker |
| TC-5-05 | Delete the new type while no Vendor references it | HTTP 204 (hard delete) |
| TC-5-06 | Create Vendor Type with duplicate name (case-insensitive) | HTTP 422 |
| TC-5-07 | Create Vendor Type with whitespace-only name | HTTP 422 |
| TC-5-08 | Create Vendor Type with 51-char name | HTTP 422 |
| TC-5-09 | Manage Vendor Types screen | Each row shows only Delete affordance; no Modify/rename button |
| TC-5-10 | Delete button on a referenced type | Greyed-out with tooltip listing dependents |
| TC-5-11 | Operational user calls any `/vendor-types` endpoint | HTTP 403 |
| TC-5-12 | Create Vendor Type X, create a Vendor referencing X, soft-delete that Vendor, then `DELETE /vendor-types/{X.id}` | HTTP 204 (soft-deleted Vendors do not block Vendor Type deletion) |

## 6. Vendors

### Happy path
- Given SA/Admin submits a valid Vendor form, When accepted, Then VEN (5-digit auto-increment from 10001) is assigned.
- Given a seeded deployment, When the Vendor list is opened, Then a default Innoviti vendor exists with Vendor Type=Innoviti and no GST requirement.
- Given Modify is submitted on a vendor, When valid, Then the row updates and a change-log entry is written.

### Field validation
- Company Name: required; 1–100 chars; uniqueness not required by spec, so duplicate names accepted (assertion: duplicate-name vendor creation succeeds).
- Vendor Type: required; must be an existing Vendor Type.
- GST Number: mandatory and globally unique for all vendors except the default Innoviti vendor; "27AAAAA0000A1Z5" accepted; "27aaaaa0000a1z5" rejected (uppercase only); "27AAAA0000A1Z5" rejected (4 letters in name block); blank rejected for non-Innoviti; blank accepted for default Innoviti vendor only.
- Registered Office: required; must include Address Line 1, Pincode (City/State derived); Line 2 optional; distinct row from operational address.
- Operational Address (Address Line 1, Line 2, Pincode → City/State): Line 1 and Pincode required; Line 2 optional.
- Status: defaults to Active; bidirectional Active↔Inactive; editable by Admin/SA only.

### Business rules / invariants
- Hard delete blocked when any dependent record exists (Users with this vendor, Contacts with this vendor, SKUs with this vendor as SKU Vendor or in SKU↔Vendor association, Inventory Locations tagged to this vendor): SA must use Inactivate instead.
- Hard delete allowed only when zero dependents exist.
- Registered Office and Operational Address may have different pincodes — both derive City/State independently.
- **Inactive vendors remain visible in every picker** (User vendor dropdown, Contact vendor dropdown, Location vendor dropdown, SKU association dropdown) **with an "(Inactive)" badge** next to the company name. They are still selectable for new associations; only the badge signals their status.
- A Vendor flipped to Inactive then immediately referenced from a new User: succeeds; the new User's detail page shows the vendor with the "(Inactive)" badge.

### UI cases
- Vendor detail page shows a "Contact Persons" hyperlink that lists every Contact whose Vendor = this vendor (cross-ref Section 4).
- Vendor form shows two distinct sub-address blocks labelled "Registered Office" and "Operational Address".
- Status toggle is visible only to SA and Admin; hidden for operational users (operational users have no access at all per decisions, so this is a redundant safeguard).
- Delete button is greyed-out with tooltip listing dependent objects when dependents exist.

### API parity
- POST /vendors, PATCH /vendors/{id}, PATCH /vendors/{id}/status, DELETE /vendors/{id} mirror UI.

### Edge & boundary
- Innoviti default vendor: cannot be hard-deleted (always has dependents); can be Inactivated by SA only.
- Vendor created with GSTIN that matches a soft-deleted vendor's GSTIN: rejected (uniqueness includes soft-deleted).
- Pincode for Registered Office different from Operational Address: both City/State pairs resolved independently.

### Negative / security
- Operational user calls any /vendors endpoint: rejected.
- Admin attempts to set Status when decision restricts to SA/Admin: allowed for both; non-SA/Admin: rejected.
- Non-SA attempts hard delete: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-6-01 | List `/vendors` on fresh install | Returns the seeded Innoviti vendor with no GST |
| TC-6-02 | Create first non-seed Vendor | `vendor_index = VEN-10001` (or next after seed) |
| TC-6-03 | Create non-Innoviti vendor with no GST | HTTP 422 |
| TC-6-04 | Create non-Innoviti vendor with `gst = "27AAAAA0000A1Z5"` | HTTP 201 |
| TC-6-05 | Create vendor with `gst = "27aaaaa0000a1z5"` (lowercase) | HTTP 422 |
| TC-6-06 | Create vendor with `gst = "27AAAA0000A1Z5"` (4 letters) | HTTP 422 |
| TC-6-07 | Create two vendors with the same GST | Second create returns HTTP 422 |
| TC-6-08 | Create vendor with GST matching a soft-deleted vendor's GST | HTTP 422 |
| TC-6-09 | Two vendors with duplicate `company_name` | Both succeed (no uniqueness) |
| TC-6-10 | `DELETE /vendors/{id}` with ≥1 dependent (Contact/User/Location/SKU) | HTTP 409 with dependency list |
| TC-6-11 | `DELETE /vendors/{id}` with zero dependents | Soft delete succeeds |
| TC-6-12 | Attempt hard delete of seeded Innoviti vendor | Rejected (always has dependents); SA must Inactivate |
| TC-6-13 | Toggle vendor Status to Inactive | Vendor remains in all pickers with "(Inactive)" badge |
| TC-6-14 | View User detail tagged to Inactive vendor | Vendor displayed with "(Inactive)" badge |
| TC-6-15 | Click "Contact Persons" hyperlink on vendor detail | Lists every Contact whose `vendor_id` matches |
| TC-6-16 | Update Innoviti vendor's GST to null | Allowed (Innoviti exception) |
| TC-6-17 | Submit registered office and operational address with different pincodes | Both lookups fire independently; both city/state pairs persist |
| TC-6-18 | Non-SA/Admin sets vendor Status | HTTP 403 |
| TC-6-19 | Operational user calls any `/vendors` endpoint | HTTP 403 |
| TC-6-20 | Open Vendor detail page | Shows lists of associated Users, Locations, and SKUs |
| TC-6-21 | `GET /vendors?status=Active` | Returns only Active vendors |
| TC-6-22 | `GET /vendors?vendor_type_id={id}` | Returns only vendors of that type |
| TC-6-23 | `GET /vendors/{id}` response | Includes `contact_persons_url` field |

## 7. SKU Types

### Happy path
- Given Admin/SA opens Manage SKU Types, When the page loads, Then Payment Terminal, Base Station, SIM Card, Assembly Line Assets, Adaptors, USB cables, Paper rolls, Tools, Consumables, Spare Parts are listed.
- Given Admin/SA creates a new SKU Type "Battery Pack" with Serial-eligible=false, When submitted, Then the type appears in the SKU Type picklist with the flag persisted.
- Given Admin/SA renames an existing SKU Type (e.g. "Tools" → "Hand Tools"), When submitted, Then the new label is reflected everywhere; the underlying type id is unchanged.

### Field validation
- Type name required, 1–50 chars, unique.
- Serial-eligible flag: boolean, required at create-time; **immutable after creation**.

### Business rules / invariants
- Seeded Serial-eligible=true for Payment Terminal, Base Station, SIM Card; false for Assembly Line Assets, Adaptors, USB cables, Paper rolls, Tools, Consumables, Spare Parts.
- Constraint "STM=Serial allowed only when the SKU Type's Serial-eligible flag is true": SKU create/edit with STM=Serial against a flag=false type → rejected (cross-ref Section 8).
- **SKU Types are not deletable.** There is no DELETE endpoint and no delete affordance in the UI; SKU types live forever for historical and reporting purposes.
- Attempt to PATCH `serial_eligible` on any existing SKU Type (seeded or user-created): rejected with 422.

### UI cases
- Each row shows the Serial-eligible flag as a **read-only indicator** (no toggle); the flag is set only on the Add SKU Type form.
- **No Delete affordance is rendered** on any row — SKU types cannot be deleted.

### API parity
- POST /sku-types and PATCH /sku-types/{id} (name only — `serial_eligible` rejected) mirror UI. **No DELETE endpoint** is exposed for SKU Types.

### Edge & boundary
- Setting `serial_eligible=false` at create-time and then trying to flip it true via PATCH: rejected; the type must be re-created with the new flag value.
- Name uniqueness applies across all SKU Types — names live forever once taken, since SKU types cannot be deleted.

### Negative / security
- Operational user calls any /sku-types endpoint: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-7-01 | List `/sku-types` on fresh install | Returns 10 seeded types with `serial_eligible` flags matching the spec |
| TC-7-02 | `PATCH /sku-types/{id}` with new `serial_eligible` value | HTTP 422 (immutable) |
| TC-7-03 | `PATCH /sku-types/{id}` to rename only (e.g. "Tools" → "Hand Tools") | HTTP 200 |
| TC-7-04 | Create SKU Type `"Battery Pack"`, `serial_eligible = false` | HTTP 201; flag persisted |
| TC-7-05 | Create SKU Type with duplicate name (case-insensitive) | HTTP 422 |
| TC-7-06 | Create SKU with type "Adaptors" and `stm = "Serial"` | HTTP 422 (cross-ref §8) |
| TC-7-07 | Create SKU with type "Payment Terminal" and `stm = "None"` | HTTP 422 |
| TC-7-08 | Any role calls `DELETE /sku-types/{id}` | Rejected — no DELETE endpoint exists; SKU types are non-deletable |
| TC-7-09 | Inspect Manage SKU Types screen | No delete affordance rendered on any row |
| TC-7-10 | Pick SKU Type in Add SKU form | STM dropdown locks and auto-sets the correct value |
| TC-7-11 | Operational user calls any `/sku-types` endpoint | HTTP 403 |

## 8. SKU (including SKU↔Vendor association)

### Happy path
- Given valid inputs, When SKU is created, Then SKU number INN-10001 (then incremented) is assigned and the row persists with all fields.
- Given a Payment Terminal SKU with all required pickers populated, When submitted, Then the SKU is created and shows the chosen Adaptors, USB cables, and Parent SKU.
- Given Modify is submitted on an existing SKU's price, When valid, Then the row updates and a change-log entry is written.

### Field validation
- SKU name: required, 1–100 chars.
- Description: optional, free text.
- STM: must be "Serial" or "None"; defaults per SKU Type's Serial-eligible flag suggestion (UI may pre-select but user can change within allowed range).
- SKU Type: required; immutable after creation — Modify request that changes SKU Type is rejected.
- Adaptor multi-select: required only when SKU Type=Payment Terminal; rejected if empty for Payment Terminal; ignored for other types.
- USB Cable multi-select: same rule as Adaptor.
- Parent SKU: required only when SKU Type=Payment Terminal; rejected if empty for Payment Terminal.
- Specifications PDF: required; max **10 MB**; non-PDF MIME rejected; >10 MB upload rejected; **only the latest version is retained** — a re-upload overwrites the previous file (no version history).
- Approximate price: MOQ (positive integer) and unit price (positive decimal) both required.
- Status: Active by default; bidirectional Active↔Inactive.

### SKU↔Vendor association (supplier rows — all peers, no primary)
- Given an SKU is created, When SA/Admin adds a Vendor via the association table, Then a row is persisted with Vendor SKU number, Vendor SKU spec PDF, Vendor SKU price (MOQ + unit price). **No row is marked "primary"** — all supplier rows are peers.
- Vendor SKU number required; the tuple `(sku_id, vendor_id, vendor_sku_number)` is unique across non-deleted rows. The same vendor may add multiple rows for the same SKU as long as the `vendor_sku_number` differs.
- Vendor SKU spec PDF: **10 MB cap**, PDF MIME, latest version only (overwrite on re-upload).
- Vendor SKU price required.
- An SKU may have zero, one, or many supplier rows. Zero is permitted by the API; the SKU detail page flags zero-supplier SKUs with a warning but does not block them.
- DELETE on any supplier row succeeds (soft delete) without primary-related rejections.
- Inactive Vendors are selectable when adding a supplier row (matches §6: inactive vendors remain in pickers with a badge).

### Business rules / invariants
- STM=Serial blocked when SKU Type's Serial-eligible flag is false: rejection message names the type and flag (cross-ref Section 7).
- Payment Terminal creation blocked when no candidate Adaptor SKUs, no candidate USB Cable SKUs, or no Terminal Parent SKUs exist: the form surfaces an explicit "Cannot create — missing prerequisites" message naming the empty picker(s).
- Setting an Adaptor / USB Cable / Terminal Parent SKU to Inactive while ≥1 active Payment Terminal SKU references it: allowed; a warning pop-up is shown listing the dependent Payment Terminal SKUs; the dependent SKU's detail page highlights the stale reference in red.
- Soft delete of an SKU: row retained with `deleted_at`; SKU number not reused.

### UI cases
- SKU form reveals Adaptor multi-select, USB Cable multi-select, and Parent SKU picker only when SKU Type=Payment Terminal; these inputs are hidden for all other types.
- SKU detail page lists all supplier rows in a single association table; no "primary" column or badge.
- Stale-reference highlight: red badge on the SKU detail page beside any Adaptor/USB/Parent reference whose Status=Inactive.

### API parity
- POST /skus, PATCH /skus/{id}, DELETE /skus/{id} (soft), POST /skus/{id}/vendors (add supplier), PATCH /skus/{id}/vendors/{assocId}, DELETE /skus/{id}/vendors/{assocId} all mirror UI; spec-PDF upload endpoint enforces the **10 MB** size cap and PDF MIME rule. Re-upload **overwrites** the existing file — no version-list endpoint.

### Edge & boundary
- Empty Adaptor picklist (no Adaptor SKUs exist): Add Payment Terminal SKU form is blocked at submit-time with a clear message.
- Spec PDF exactly 10 MB: accepted; 10 MB + 1 byte: rejected.
- Re-upload of spec PDF: the prior file is replaced and is **not** retrievable; no `/versions` endpoint exists.
- The same Vendor adding two rows for the same SKU with **different** `vendor_sku_number` values: both rows accepted (peers).
- The same Vendor adding two rows for the same SKU with the **same** `vendor_sku_number`: second row rejected (uniqueness on `(sku_id, vendor_id, vendor_sku_number)`).
- Modify attempt that changes SKU Type: rejected even via API.

### Negative / security
- Operational user calls any /skus endpoint: rejected.
- Vendor user (any vendor association) attempts to add themselves as an additional supplier without SA/Admin role: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-8.1-01 | Create Payment Terminal SKU while no Adaptor SKU exists | HTTP 422 with "create Adaptor SKU first" message |
| TC-8.1-02 | Create Payment Terminal SKU while no USB cable SKU exists | HTTP 422 |
| TC-8.1-03 | Create Payment Terminal SKU while no Terminal Parent SKU exists | HTTP 422 |
| TC-8.1-04 | Create Payment Terminal SKU with valid Adaptor / USB / Parent picks | HTTP 201; `sku_number = INN-10001` (or next) |
| TC-8.1-05 | `PATCH /skus/{id}` attempting to change `sku_type_id` | HTTP 422 |
| TC-8.1-06 | Upload `specifications_pdf` of 10 MB exactly | HTTP 201/200 (accepted) |
| TC-8.1-07 | Upload `specifications_pdf` of 10 MB + 1 byte | HTTP 422 |
| TC-8.1-08 | Upload a `.docx` as `specifications_pdf` | HTTP 422 (MIME) |
| TC-8.1-09 | Re-upload `specifications_pdf` | Previous file overwritten; no `/versions` endpoint |
| TC-8.1-10 | Toggle Adaptor SKU referenced by an Active Payment Terminal SKU to Inactive | Warning lists dependents; on confirm, dependent's detail page renders Adaptor reference in red |
| TC-8.1-11 | Create SKU with `serial_eligible = false` type and `stm = "Serial"` | HTTP 422 |
| TC-8.1-12 | `DELETE /skus/{id}` | Soft delete; row retained; SKU number not reused |
| TC-8.1-13 | Filter `GET /skus?vendor_id=...` | Matches primary OR any vendor association |
| TC-8.1-14 | SKU form for non-Payment-Terminal type | Adaptor/USB/Parent inputs hidden |
| TC-8.3-01 | Create vendor association twice with same `(sku_id, vendor_id, vendor_sku_number)` | First succeeds; second HTTP 422 |
| TC-8.3-02 | Create two associations for same (sku, vendor) with different vendor SKU numbers | Both succeed |
| TC-8.3-03 | DELETE the only supplier row of an SKU | HTTP 200; SKU detail flags "zero suppliers" warning |
| TC-8.3-04 | Look for "primary supplier" affordance in UI or API | None exists |
| TC-8.3-05 | Upload vendor spec PDF > 10 MB | HTTP 422 |
| TC-8.3-06 | Re-upload vendor spec PDF | Previous file overwritten |
| TC-8.3-07 | Add supplier row with an Inactive Vendor | HTTP 201 (Inactive vendors remain selectable) |
| TC-8.3-08 | `GET /skus/{sku_id}/vendors` after multiple inserts | Rows returned in insertion order |
| TC-8-99 | Operational user calls any `/skus` endpoint | HTTP 403 |
| TC-8.1-15 | Create SKU with empty `sku_name` | HTTP 422 |
| TC-8.1-16 | Create SKU with 101-char `sku_name` | HTTP 422 |
| TC-8.1-17 | Create SKU with 100-char `sku_name` | HTTP 201 |
| TC-8.1-18 | Create SKU with `approx_price_moq = 0` | HTTP 422 (must be ≥1) |
| TC-8.1-19 | Create SKU with `approx_price_unit = -0.01` | HTTP 422 (must be ≥0) |
| TC-8.1-20 | Create SKU with `approx_price_moq = 1` and `approx_price_unit = 0` | HTTP 201 |
| TC-8.1-21 | `POST /skus/{id}/status` toggle Active → Inactive | HTTP 200; status flips; change-log row with `action = StatusToggle` |
| TC-8.1-22 | Soft-delete an SKU, then `POST /skus/{id}/status` to Active | HTTP 200; SKU reactivated (soft delete is reversible via status toggle) |
| TC-8.1-23 | `GET /skus?sku_type_id={id}` | Returns only SKUs of that type |
| TC-8.1-24 | `GET /skus?status=Inactive` | Returns only Inactive SKUs |
| TC-8.1-25 | Open SKU detail page for Payment Terminal SKU | Vendor SKU pop-up modal lists every (SKU × Vendor) association as peers |

## 9. Terminal Parent SKU

### Happy path
- Given valid inputs, When a Terminal Parent SKU is created, Then PNN-10001 (then incremented) is assigned.
- Given Modify on name/description, When valid, Then the row updates and a change-log entry is written.

### Field validation
- Terminal Parent SKU name: required, 1–100 chars, unique across active records.
- Description: optional, free text.

### Business rules / invariants
- No Status field — assert any attempt to PATCH a `status` field on this object is ignored or rejected.
- Hard delete blocked when ≥1 Payment Terminal SKU references this Parent SKU: rejection lists the referencing SKUs.
- Hard delete allowed when zero Payment Terminal SKUs reference it.
- Soft delete is not used for this object (decision: hard delete with referential block).

### UI cases
- Delete affordance is greyed-out with tooltip when dependents exist.
- Terminal Parent SKU detail page shows the list of Payment Terminal SKUs that reference it (read-only).

### API parity
- POST /terminal-parent-skus, PATCH /terminal-parent-skus/{id}, DELETE /terminal-parent-skus/{id} mirror UI.

### Edge & boundary
- Delete attempt with one referencing Payment Terminal SKU: rejected; after that SKU is soft-deleted (and excluded from active list), assert whether Parent SKU delete now succeeds — per decision, soft-deleted SKUs still count as references (safer interpretation), so delete remains blocked until the referencing SKU is purged. (Assertion: delete blocked while any non-purged reference exists.)

### Negative / security
- Operational user calls any /terminal-parent-skus endpoint: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-9-01 | Create Payment Terminal SKU before any Terminal Parent SKU exists | HTTP 422 |
| TC-9-02 | Create first Terminal Parent SKU | `parent_sku_number = PNN-10001` |
| TC-9-03 | Create Terminal Parent SKU with duplicate name (case-insensitive) | HTTP 422 |
| TC-9-04 | `DELETE /terminal-parent-skus/{id}` while ≥1 Payment Terminal SKU references it | HTTP 409 with referencing-SKU list |
| TC-9-05 | `DELETE /terminal-parent-skus/{id}` with zero references | HTTP 204 (hard delete) |
| TC-9-06 | Soft-delete all referencing SKUs, then attempt Parent SKU delete | Still rejected (soft-deleted SKUs retain `parent_sku_id`) |
| TC-9-07 | Inspect Terminal Parent SKU response | No `status` field present |
| TC-9-08 | PATCH a `status` field on this object | Ignored or rejected |
| TC-9-09 | Modify name/description | Row updates; one change-log entry written |
| TC-9-10 | Operational user calls any `/terminal-parent-skus` endpoint | HTTP 403 |

## 10. Inventory Locations

### Happy path
- Given valid inputs, When a Location is created, Then LIN (8-digit auto-increment from 10000001) is assigned.
- Given Modify on address fields, When valid, Then City/State re-derive from the new Pincode and the row updates.
- Given soft delete on a Location, When committed, Then it disappears from active lists; historical inventory references retain the LIN (cross-ref Foundations soft delete).

### Field validation
- Vendor tagged to: required; Active or Inactive Vendor accepted (cross-ref §6 — inactive vendors remain selectable with a badge).
- Location Name: required; 1–100 chars; **no uniqueness constraint** — duplicates allowed within or across vendors.
- Address Line 1: required.
- Address Line 2: optional.
- Pincode: 6-digit required; City/State derived.
- Principal Contact: required at the moment of selection; must be a non-deleted Contact whose Vendor = the Location's current Vendor at that moment.
- Secondary Contact: optional; if provided, must differ from Principal and must be a Contact of the same Vendor at the moment of selection.

### Business rules / invariants
- No Status field — any PATCH targeting a `status` attribute is rejected.
- Soft delete only — hard delete not exposed via UI or API.
- "Vendor tagged to" change: editable by SA only; non-SA (including Admin) attempt → rejected.
- **Vendor change does NOT clear contacts**: after SA changes a Location's Vendor, the previously selected Principal and Secondary contacts are preserved as-is on the Location, even if they now belong to a different Vendor. No confirmation modal warns about contact-clearing because no clearing occurs.
- A cross-vendor contact reference (Location's vendor ≠ contact's vendor) persists indefinitely until SA explicitly re-edits the contact pickers. The Location detail page renders the mismatched contact with an "(other vendor)" annotation but does not block reads or other edits.
- Historical inventory references retained after Vendor change — assertion validated when stock data exists (covered narratively here; concrete stock-movement tests are out of scope for this phase).
- Soft-deleted Contact still appears in Locations where it was Principal/Secondary (cross-ref Section 4) but cannot be selected for a new Location.

### UI cases
- Vendor change UI: SA only; **no contact-clearing confirmation modal** is shown. The existing Principal/Secondary contact selections remain after the vendor change.
- Location detail page shows Vendor, Principal Contact, Secondary Contact, and address. If a contact's Vendor no longer matches the Location's Vendor, an "(other vendor)" annotation appears next to that contact's name.
- Same Location Name under two different Vendors: both rows accepted and visible.
- Same Location Name under the **same** Vendor: also accepted (no uniqueness rejection).

### API parity
- POST /locations, PATCH /locations/{id}, PATCH /locations/{id}/vendor (SA-only), DELETE /locations/{id} (soft) mirror UI.

### Edge & boundary
- Secondary Contact = Principal Contact: rejected.
- Vendor with zero non-deleted contacts: Add Location form blocks at submit with message "No contacts exist for this Vendor — add a contact first" (cross-ref Section 4).
- Location Name duplicate within the same Vendor: **accepted** (no uniqueness constraint).
- Location Name duplicate across different Vendors: accepted.
- After SA changes a Location's Vendor to a Vendor whose contact list does not include the existing Principal Contact: the Location is saved with the stale contact intact and rendered with "(other vendor)" annotation; no rejection.

### Negative / security
- Admin attempts PATCH /locations/{id}/vendor: rejected.
- Operational user calls any /locations endpoint: rejected.

### Change log
- See Section 11.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-10-01 | Create first Location | `location_index = LIN-10000001` |
| TC-10-02 | Create Location without `principal_contact_id` | HTTP 422 |
| TC-10-03 | Create Location with `secondary_contact_id = principal_contact_id` | HTTP 422 |
| TC-10-04 | Pick Principal Contact whose vendor ≠ Location's vendor (at moment of assignment) | HTTP 422 |
| TC-10-05 | Non-SA user `PATCH /locations/{id}/vendor` | HTTP 403 |
| TC-10-06 | Admin attempts `PATCH /locations/{id}/vendor` | HTTP 403 (SA only) |
| TC-10-07 | SA `PATCH /locations/{id}/vendor` to change vendor | HTTP 200; existing Principal/Secondary contacts preserved as-is, even if cross-vendor; no clearing modal shown |
| TC-10-08 | Two Locations with the same name under the same Vendor | Both succeed (no uniqueness) |
| TC-10-09 | Two Locations with the same name under different Vendors | Both succeed |
| TC-10-10 | Soft-delete a Contact that is Principal on a Location | Location detail still shows the contact with "deleted" badge |
| TC-10-11 | Open Add Location form for a Vendor with zero Contacts | Inline message "No contacts exist for this Vendor — add a contact first"; submission blocked |
| TC-10-12 | Open contact picker after SA changed vendor on a Location | Picker lists only new Vendor's contacts; previously selected cross-vendor contacts remain with "(other vendor)" annotation |
| TC-10-13 | `DELETE /locations/{id}` | Soft delete; historical inventory references retain the LIN |
| TC-10-14 | Inspect Location response | No `status` field |
| TC-10-15 | PATCH targeting a `status` field on this object | Rejected |
| TC-10-16 | Create Location tagged to an Inactive Vendor | HTTP 201 (Inactive vendors remain selectable, badged in picker) |
| TC-10-17 | Operational user calls any `/locations` endpoint | HTTP 403 |

## 11. Change Log (cross-cutting, minimal)

The change log records **one row per mutation**: object, actor, action, timestamp. It does **not** capture per-field old→new diffs. Per-object Activity/History panels do not exist in this phase; only a global Admin-only screen does.

### Append on every mutation
- Given any Section-1 object create succeeds, When the response returns, Then exactly one log row exists with `object_type`, `object_id`, `action=Create`, `actor_user_id`, `actor_user_index` (denormalized snapshot), and `occurred_at` (UTC).
- Given any Section-1 object update with at least one field change succeeds, Then exactly one log row exists with `action=Update`.
- Given any Section-1 object soft-delete succeeds, Then exactly one log row exists with `action=SoftDelete`.
- Given a hard-delete-allowed object (Vendor Type unused, Terminal Parent SKU unreferenced), When hard delete succeeds, Then exactly one log row exists with `action=HardDelete`.
- Given a User/Vendor/SKU status toggle, Then exactly one log row exists with `action=StatusToggle`.
- Given a spec PDF upload (SKU or Vendor-SKU), Then exactly one log row exists with `action=Upload`.
- Log rows contain **no** `field_name`, `old_value`, or `new_value` columns.

### Actor capture
- Given any mutation via UI, Then the log actor = the authenticated user's id.
- Given any mutation via API with an API token, Then the log actor = the user-id bound to the token.
- Given the SA seeded mutation (first-Admin creation), Then actor = SA's seeded user id.

### Queryability by Admin
- Admin can query log rows filtered by `object_type`, `object_id`, actor, and timestamp range; results are paginated.
- SA can query the same.
- Operational user attempts to query the change log: rejected.
- **No per-object Activity/History UI** is rendered on Section-1 object detail pages in this phase.

### Immutability
- Attempt to PATCH a log row: rejected (read-only).
- Attempt to DELETE a log row: rejected.
- Backup snapshots include log rows (cross-ref Foundations backups).

### Edge & boundary
- High-frequency updates (e.g. 100 PATCHes on one user in 1 minute, each changing at least one field): exactly 100 log rows appear with monotonically increasing `occurred_at`.
- Update that submits no actual field change (idempotent PATCH): **no log row is written**.
- Mutation succeeds but the log-row write fails inside the same transaction: the parent mutation is rolled back; the response is a 500 and no object change is persisted.

### Test Cases & Expected Results

| TC ID | Test Case | Expected Result |
|---|---|---|
| TC-11-01 | Create any Section-1 object | One log row with `action = Create`, actor, denormalized `actor_user_index`, UTC `occurred_at` |
| TC-11-02 | Update any Section-1 object with ≥1 field change | One log row with `action = Update` |
| TC-11-03 | Soft-delete any Section-1 object | One log row with `action = SoftDelete` |
| TC-11-04 | Hard-delete an unused Vendor Type or unreferenced Terminal Parent SKU | One log row with `action = HardDelete` |
| TC-11-05 | Toggle a User/Vendor/SKU status | One log row with `action = StatusToggle` |
| TC-11-06 | Upload SKU spec or Vendor-SKU spec PDF | One log row with `action = Upload` |
| TC-11-07 | `PATCH` with identical values (no actual change) | Zero log rows written |
| TC-11-08 | Inspect log row schema | No `field_name`, `old_value`, or `new_value` columns |
| TC-11-09 | Mutation via UI | Log actor = authenticated user id |
| TC-11-10 | Mutation via API token | Log actor = user id bound to token |
| TC-11-11 | SA-seeded first-Admin create | Log actor = SA's seeded user id |
| TC-11-12 | Admin queries `/change-log` filtered by `object_type` + `object_id` | HTTP 200 with paginated results |
| TC-11-13 | SA queries `/change-log` | HTTP 200 |
| TC-11-14 | Operational user queries `/change-log` | HTTP 403 |
| TC-11-15 | Open any Section-1 object detail page | No per-object Activity/History panel rendered |
| TC-11-16 | Attempt to PATCH a log row | Rejected (read-only) |
| TC-11-17 | Attempt to DELETE a log row | Rejected |
| TC-11-18 | Inspect a backup snapshot | Log rows included |
| TC-11-19 | Perform 100 distinct PATCHes on one user in 1 minute | Exactly 100 log rows with monotonically increasing `occurred_at` |
| TC-11-20 | Force log-row write failure inside a parent mutation transaction | Parent mutation rolled back; HTTP 500; no object change persisted |
| TC-11-21 | Rename an actor user after they performed changes, then re-query log | `actor_user_index` snapshot preserved (not affected by rename) |
| TC-11-22 | `GET /users/{id}/change-log` for an actor | Returns timeline of changes made by that user |
| TC-11-23 | `GET /change-log/{object_type}/{object_id}` convenience endpoint | Returns the full timeline for that one object |
| TC-11-24 | `GET /change-log?date_from=...&date_to=...` | Returns log rows whose `occurred_at` falls in the range |

## Out of scope for this phase
- Google SSO authentication (UI entry present but disabled; no backend route).
- Audit-report review workflow (UI entry present but disabled; no backend route).
- Order creation, split-order numbering, and order-lifecycle flows.
- Dispatch and retrieval generation flows.
- Audit workflow including location-locked audits and the "Locked Audit Location" user field.
- MIS reports and dashboards beyond the Manage-User and Vendor-detail screens covered above.
- Load Data flows (`_Load_data_requirements.txt` is out of scope this round).
- Master records ingestion and master-record lifecycle.
- Inter-Location Transfer Types and Location Types object creation (mentioned in Admin scope but not detailed in Section 1).
- Inventory item creation, item-level stock movements, and item state transitions.
