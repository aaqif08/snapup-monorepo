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
npm run dev:customer
```

**Run the admin dashboard** (http://localhost:3001):
```bash
npm run dev:admin
```

**Run both at once** (via Turborepo):
```bash
npm run dev
```

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
