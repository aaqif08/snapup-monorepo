# SnapUp Monorepo

This is the restructured SnapUp web project — a Turborepo monorepo containing
both the customer-facing app and the new business owner/admin dashboard.

## Structure

```
snapup-monorepo/
├── apps/
│   ├── customer-web/    # Customer scan-and-pay app (was standalone snapup-web)
│   └── admin-web/        # NEW: Business owner dashboard — analytics, products, staff, security
├── packages/
│   └── ui/                # Shared brand tokens (colors) + logo assets, used by both apps
├── package.json           # Workspace root
└── turbo.json
```

## Extracting the zip (read this first)

Same note as before: extract to a folder **outside any OneDrive-synced path**
on Windows. Next.js's dev server writes constantly to `.next/`, and OneDrive's
sync client does not handle this well — it causes `EBUSY`/`EINVAL: readlink`
errors that have nothing to do with the app code. Extract to e.g. `C:\dev\`,
not `Desktop\` if your Desktop is OneDrive-backed.

## Run locally

From the monorepo root:

```bash
npm install
```

This installs dependencies for **both** apps and the shared package in one
pass (npm workspaces).

**Run the customer app** (http://localhost:3000):
```bash
SNAPUP_PRESENCE_DEV_BYPASS=1 npm run dev:customer
```

On Windows PowerShell, which has no inline `VAR=x cmd` prefix, that is two statements:
```powershell
$env:SNAPUP_PRESENCE_DEV_BYPASS = "1"
npm run dev:customer
```

The bypass flag is needed locally. The customer app now refuses database access unless the
request comes from a registered store network (see "Secure gateway" below), and a request
from your laptop has no meaningful public IP, so without it every lookup is denied. The
flag is ignored in production builds.

**Run the admin dashboard** (http://localhost:3001):
```bash
npm run dev:admin
```

The admin console's **Stores** page writes to the customer app's store registry, so run
both together if you want to add a store and see it appear for customers. It reaches the
registry at `SNAPUP_API_BASE` (default `http://localhost:3000`).

**Validate the security requirements** — builds, starts a production server, runs 88 cases
over real HTTP, exits non-zero on failure:
```bash
npm run validate
```

**Run both at once** (via Turborepo):
```bash
npm run dev
```

## Secure gateway (`apps/customer-web/src/server`)

Implements the four requirements from *CTO Requirement's Solution [Detailed Report]*.
**Full write-up, including one deviation from the report that needs the CTO's sign-off:
[`docs/cto-requirements-implementation.md`](docs/cto-requirements-implementation.md).**

The short version:

- **The product catalogue is no longer in the browser bundle.** It used to be
  `MOCK_PRODUCT_DB` in `src/lib/mockData.ts`, imported by the scanner page, which meant
  anyone could read the whole table from devtools. It now lives in `src/server/products/`
  behind `import 'server-only'` — a build-time guarantee that it cannot be pulled back
  into client code.
- **Database access requires two proven presence factors**: a signed, 120-second entrance
  QR, *and* a request whose server-observed egress IP falls inside the store's registered
  network. Either alone is refused.
- **The report specifies SSID checking for factor 2. Browsers cannot read the SSID**, so
  that is implemented as server-side egress IP verification instead — which is stronger,
  because the customer's device never gets a say. This changes what the report promises
  and is written up in full in the doc above.
- **Sessions die when the customer leaves.** The egress IP is signed into the session
  token, so leaving the store network breaks the binding and every API call is refused.
  No session store, no cleanup job — which is what makes it work on serverless.

Anything a customer receives passes through `toPublicProduct()`, which allowlists six
fields and withholds cost price, margin, supplier, stock, SKU and purchase history.

## Stores and device location (`apps/customer-web/src/server/stores`)

One registry holds each store's **location and its network registration together**, because
they answer the two halves of the same question: where the shop appears in the customer's
list, and whether anyone standing in it can actually shop.

- **Distances are real and computed server-side** (`geo.ts`, haversine). They used to be
  hardcoded constants in `mockData.ts`, so every customer was told a store was 1.2 km away
  regardless of where they were.
- **Location is requested, never assumed.** `useDeviceLocation.ts` checks the Permissions
  API first, so a customer who granted access is not re-prompted and one who declined is
  not nagged. Declining is a supported state: the directory still works, unordered and
  without distances, rather than inventing one.
- **Admins add stores at runtime** from the console's Stores page — no redeploy. A store
  saved without its Wi-Fi gateway IP is flagged on save and **refuses every customer**
  until it is filled in, rather than admitting everyone.
- **The admin token never reaches a browser.** `apps/admin-web` proxies through its own
  server routes. Write access to the registry is effectively the ability to authorise a
  network, so that credential is kept server-side.

Environment variables (`SNAPUP_QR_SECRET` and `SNAPUP_SESSION_SECRET` are **required in
production** and fail closed) are documented in the doc above.

## Admin dashboard (`apps/admin-web`)

Login is mocked locally — any email containing `@` and a password of 6+
characters logs you in as a `manager`. In production this calls a real
`POST /auth/login` validated against the `staff_profiles` table and RBAC
middleware from the architecture doc. This is a **separate login from the
customer app** — owners/managers/staff do not use the customer's phone-OTP
flow.

### Screens

- **Dashboard** (`/`) — KPI cards (today's revenue, orders, average basket,
  open anomalies) plus a 7-day revenue trend chart and a category breakdown
  chart (Recharts). A low-stock banner appears when any active product is
  at or below its reorder threshold.
- **Products** (`/products`) — full CRUD. "Remove" **deactivates** a product
  rather than hard-deleting it, since past orders reference products by id
  and a hard delete would corrupt order history. Search by name, barcode, or
  category. Low-stock items are visually flagged inline.
- **Staff** (`/staff`) — add staff accounts with a role (staff/manager/admin)
  and employee code, suspend/reactivate existing accounts.
- **Security** (`/security`) — kiosk weight-mismatch anomalies (resolve as
  "legitimate" or "bill the difference") and ML-driven security flags from
  store cameras (mark reviewed / escalate), matching the `checkout_anomalies`
  and `security_flags` tables from the schema.

### What's mocked

All data in `apps/admin-web/src/lib/mockData.ts` — products, staff, sales
trend, anomalies, security flags. Every store (`useProductStore`,
`useStaffStore`, `useSecurityStore`) holds this mock data in memory and
mutates it via Zustand actions; nothing persists to a real backend yet.
Wiring this to the real API means replacing each store's initial state and
mutator functions with actual `fetch` calls to the endpoints specified in
the architecture document (`GET/POST/PATCH /products`, `/staff/users`,
`/anomalies`, `/security/flags`, `/analytics/sales`).

## Shared package (`packages/ui`)

`packages/ui/theme.js` exports the Tailwind color tokens both apps extend
from (`primary`, `accent`, `bg`, `ink`, `muted`, `border`, plus new `danger`
and `warning` tokens the admin app needed for anomaly/low-stock states that
didn't exist in the customer app). `packages/ui/assets/` holds the source
logo files; each app keeps its own copy in its own `public/` folder since
Next.js can only serve static assets from an app's own `public/` directory,
but both copies originate from this single shared source.

## Dependency security note

Same as before: `next` is pinned to `15.5.19` specifically across both apps
to avoid CVE-2025-66478 and the Dec 2025 follow-up RSC CVEs. Don't downgrade
either app's `next` version without checking https://nextjs.org/blog first.
