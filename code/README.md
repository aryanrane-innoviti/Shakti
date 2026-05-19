# Shakti 2.0 — Implementation

Stack
- **Backend**: Node.js + Express + better-sqlite3 (SQLite file)
- **Frontend**: React + Vite (vanilla JavaScript)
- **Database**: SQLite at `backend/data/shakti.db`
- **Backups**: SQLite copies in `backend/backups/`
- **Spec PDFs**: filesystem in `backend/uploads/`

## Prerequisites
- Node.js 20+ (Node 22 ideal)
- Windows / macOS / Linux

## First-time setup

```powershell
cd "D:\Shakti\Shakti 2.0\code\backend"
copy .env.example .env
# Edit .env if you want to override SA_PASSWORD, ports, etc.
npm install

cd ..\frontend
npm install
```

## Run (two terminals)

```powershell
# Terminal A — backend
cd "D:\Shakti\Shakti 2.0\code\backend"
npm run dev
# → http://localhost:4000

# Terminal B — frontend
cd "D:\Shakti\Shakti 2.0\code\frontend"
npm run dev
# → http://localhost:5173
```

## First login
- Open http://localhost:5173
- Username: `superadmin` (or whatever you set as `SA_USERNAME`)
- Password: `ChangeMe!Boot` (or your `SA_PASSWORD`)
- You will be forced into the **Initial Setup** flow to register the first Admin user before you can use the rest of the app.

The SA password is **re-synced from the config secret on every boot** — change `SA_PASSWORD` in `.env` and restart to rotate it.

## What's covered (Section 1 of `task1.md`)

| Feature | Status |
|---|---|
| Auth (login, logout, password reset URL, generic-failure responses) | ✅ |
| Initial Setup gate (SA must register first Admin) | ✅ |
| User Types (SA-only writes, immutable SA/ADMIN labels, ASCII label rule) | ✅ |
| Users (UIN, mobile optional, Innoviti employee-id rule, soft-delete, reactivation auto-reset) | ✅ |
| Contacts (NIN, vendor-required, email required but not unique) | ✅ |
| Vendor Types (immutable labels, no PATCH, hard-delete-when-unused) | ✅ |
| Vendors (VEN, two address blocks, GSTIN validation, status toggle, dep-blocked delete, inactive-vendor pickers) | ✅ |
| SKU Types (immutable `serial_eligible`, soft-delete-when-unused) | ✅ |
| SKUs (INN, type immutable, STM gated by `serial_eligible`, PT prerequisites, 10 MB PDF, latest-only) | ✅ |
| SKU↔Vendor assoc (PEERS — no primary, `(sku, vendor, vendor_sku_number)` unique) | ✅ |
| Terminal Parent SKUs (PNN, no Status, hard-delete-when-unreferenced) | ✅ |
| Locations (LIN, name not unique, vendor change keeps contacts, SA-only vendor change) | ✅ |
| Pincode lookup (third-party API, multi-city dropdown, block-on-failure) | ✅ |
| Change log (minimal: object/actor/action/timestamp, no per-field diff) | ✅ |
| Backups (daily auto + SA manual w/ filename, restore-from-list, secrets included) | ✅ |
| Branding (Raleway Light, purple/orange/grey, responsive breakpoints) | ✅ |

## Test the API directly

All endpoints are REST and return JSON. Authenticate with `Authorization: Bearer <token>`. Example:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"ChangeMe!Boot"}'
```

See `backend/src/routes/` for each object's endpoint shape — the route file names mirror the URL paths.

## Layout

```
code/
├── README.md
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── data/                 # SQLite DB lives here (created at boot)
│   ├── backups/              # SA-triggered + daily snapshots
│   ├── uploads/              # SKU spec PDFs
│   └── src/
│       ├── server.js
│       ├── db.js
│       ├── config.js
│       ├── migrations/001_init.sql
│       ├── lib/
│       │   ├── auth.js
│       │   ├── seed.js
│       │   ├── ids.js
│       │   ├── changeLog.js
│       │   └── validate.js
│       └── routes/
│           ├── auth.js
│           ├── userTypes.js
│           ├── users.js
│           ├── contacts.js
│           ├── vendorTypes.js
│           ├── vendors.js
│           ├── skuTypes.js
│           ├── skus.js
│           ├── terminalParentSkus.js
│           ├── locations.js
│           ├── changeLog.js
│           ├── backup.js
│           └── pincode.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── styles.css
        ├── components/
        │   ├── Layout.jsx
        │   ├── Modal.jsx
        │   └── PincodeField.jsx
        ├── lib/
        │   ├── api.js
        │   ├── auth.jsx
        │   └── toast.jsx
        └── pages/             # Login, Reset, InitialSetup, Users, Contacts,
                               # Vendors, VendorDetail, Locations, Skus, SkuDetail,
                               # TerminalParentSkus, ObjectTypes, ChangeLog, Backups
```

## What's intentionally out

Per `task1.md` § "Out of scope for this phase":
- Google SSO (UI hidden entirely, no backend route)
- Audit-report review (UI hidden entirely, no backend route)
- Orders, dispatch, retrieval, audit workflows
- MIS reporting
- Load-data flows and master records
- Operational user types (ASO/STU/ALU/RLU/FNU/LOU) have **no** Section 1 access — they can exist as users but every Section 1 endpoint returns 403.

## Known caveats
- After a `Restore` from a backup file, restart the backend so SQLite reopens the new DB file.
- Pincode lookup uses `api.postalpincode.in` by default — change `PINCODE_API_URL` in `.env` to swap providers.
- No HTTPS in dev. Run behind a reverse proxy for production.
