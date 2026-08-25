# SnapUp Customer — Web App

This is the web rebuild of the original SnapUp customer Expo/React Native app.
It is a **Next.js project**, not React Native — there is no app store build,
no Expo, no native camera API. Everything runs in the browser.

## Extracting the zip (read this first)

The zip contains a single top-level `snapup-web/` folder. If you right-click
the zip and choose "Extract All" in Windows, **point the destination at the
parent folder** (e.g. `Desktop\`), not at a folder already named `snapup-web` —
otherwise you'll end up with a nested `snapup-web\snapup-web\` and npm won't
find `package.json`. After extracting, confirm `package.json` sits directly
inside the folder you `cd` into before running `npm install`.

## UPI payment deep links (real, not simulated)

Tapping GPay (or PhonePe/Paytm/BHIM) on `/checkout` builds a real
`upi://pay` link per the NPCI UPI Linking Specification and redirects to
it. On an actual phone with the app installed, this genuinely opens that
app's payment confirmation screen with the amount pre-filled — see
`src/lib/upi.ts` for the link builder and `attemptUpiRedirect`'s
fallback logic.

**This opens the real app, but doesn't move real money yet.** The
merchant VPA (`pa` parameter) in `src/lib/upi.ts` is a placeholder
(`snapup.demo@upi`). To accept real payments, register with a payment
aggregator/PSP (Razorpay, Cashfree, PhonePe Business, etc.), get a real
merchant VPA, and replace the `PLACEHOLDER_MERCHANT_VPA` constant — also
worth checking whether that PSP offers a hosted checkout or SDK instead
of hand-building this link, since they handle payment-confirmation
webhooks, retries, and refunds for you.

Platform behavior differs and is worth testing on real devices:
- **Android**: the generic `upi://pay` link shows the OS's app picker if
  multiple UPI apps are installed (NPCI requires merchants support this
  generic form for the "Pay by any UPI app" option specifically).
- **iOS**: there's no picker — it opens whichever UPI app is set as
  default, and the user must manually switch back to the browser tab
  after paying; there's currently no auto-return mechanism on iOS.
- **Desktop**: no UPI app exists to catch the link, so `/checkout` shows
  a scannable QR code of the same `upi://pay` link instead — the same
  fallback real Indian e-commerce sites use for desktop UPI checkout.

## Dependency security note

This project pins `next@15.5.19` specifically — earlier 15.x releases
(including 15.1.0, which is what would come from a naive `create-next-app`
right now) carry **CVE-2025-66478**, a critical unauthenticated RCE in the
App Router's React Server Components protocol, plus two follow-up RSC
CVEs patched on Dec 11, 2025. Don't downgrade the `next` version in
`package.json` without checking https://nextjs.org/blog for newer
advisories first.

`npm audit` will still report two **moderate** PostCSS XSS findings
(GHSA-qx2v-qp2m-jg93) — these come from a PostCSS copy bundled *inside*
Next.js itself (`node_modules/next/node_modules/postcss`), not from this
project's own dependencies. `npm audit fix --force` will offer to "fix"
this by downgrading Next.js to version 9, which would reintroduce the
critical RCE above — do not run that. This is a known upstream packaging
issue to track via Next.js releases, not something fixable from this
project's `package.json`.

## Run locally

From the monorepo root:

```bash
npm install
SNAPUP_PRESENCE_DEV_BYPASS=1 npm run dev:customer
```

The bypass is needed locally because presence verification checks the request's
**egress IP** against the store's registered network range, and a loopback request
has no meaningful public IP. It is read only in development — a production build
ignores it, so the real check always runs where it matters. See
`docs/cto-requirements-implementation.md`.

Then open http://localhost:3000. You'll need to allow camera access in your
browser to test the `/scan` page (use a real phone or a laptop with a webcam —
desktop testing alone won't tell you much about real-world scan reliability).

## What's implemented in this local build

- **Landing screen** (`/`, first load only) — explicit "Continue as Guest" /
  "Login with Phone Number" choice, shown once per session until either
  option is chosen (tracked via `hasEnteredApp` in `useAuthStore.ts`).
- **Guest-first home page** (`/`, after entry) — Swiggy-Dine-In-inspired
  layout: location selector, search bar, nearest stores, recommended
  stores. Stores come from `GET /api/stores/nearby`, ordered by real
  distance from the device's coordinates (`src/lib/useDeviceLocation.ts`);
  declining location permission is a supported state — the directory still
  lists stores, just unordered and without distances.
- **Store confirm** (`/store/[id]`) — ported from `StoreScreen.tsx`, now
  driven by route params instead of a hardcoded store.
- **Scanner** (`/scan`) — rebuilt (not ported) using `getUserMedia` +
  `@zxing/library`, since `expo-camera` has no web equivalent.
- **Cart** (`/cart`) — remove is instant with no confirmation dialog, backed
  by a 4-second "Undo" toast that restores the exact item, quantity, and
  position (`restoreItem` in `useCartStore.ts`). Quantity +/- and totals
  recalculate live.
- **Guest checkout, fully supported** (`/checkout`) — guests can pay and
  receive a QR checkout token without ever logging in. There is no login
  wall; the only redirect is for an empty cart.
- **Login-to-save discount banner** (`/checkout`, `DiscountBanner.tsx`) —
  shown only to unauthenticated users with a cart, computes a live 5%
  figure from the real cart subtotal, dismissible for the session.
  Authenticated users see the discount applied directly in the bill
  instead of the banner.
- **Payment options + exit QR** (`/checkout`) — ported from
  `PaymentScreen.tsx`, using `qrcode.react` instead of
  `react-native-qrcode-svg`. The basket is priced by the server and the exit
  token is HMAC-signed server-side; see "Orders and payment" below.

## Known mocks / things to wire to a real backend

- **Auth is still mocked** (`useAuthStore.ts`). Product and store data are
  no longer: both moved server-side behind real API routes — see
  `docs/cto-requirements-implementation.md` for the presence-verified
  product gateway and the admin-managed store registry.
- **Storage has three backends behind one interface**, chosen in each domain's
  `src/server/*/repository.ts`:

  1. **The retailer's API** (`SNAPUP_STORE_API_BASE` + `SNAPUP_STORE_API_KEY`)
     — the agreed model. The supermarket hosts the database, only the store
     owner can reach it, and SnapUp is issued a key. We hold no copy of their
     data, so their system stays the authority on price and stock.

     A chain is not necessarily one system, so a branch may carry its own
     `apiBaseUrl` and `apiKeyRef` and be reached at its own endpoint with its
     own credential — see `docs/branch-onboarding.md`. `apiKeyRef` is the
     *name* of an environment variable, never a key: the registry is editable
     in the console and backed up, so nothing secret may live in it. The store
     registry itself always uses the platform-wide values, because resolving a
     branch's endpoint means reading that branch's record.
  2. **Postgres** (`DATABASE_URL`) — for data SnapUp owns, and the fallback if
     the arrangement changes. `npm run db:migrate` applies
     `src/server/db/schema.sql` and seeds nothing, deliberately: the seed
     registers branches with no network range and no coordinates, so a seeded
     deployment would stand up stores that refuse every shopper. That is the
     correct fail-closed behaviour, and `storeReadiness()` names the gap rather
     than leaving it to be discovered on the shop floor.
  3. **In memory** — the seeded fallback. Not pilot-safe; kept because it is
     what makes `npm run validate` runnable with no database and no upstream,
     and it carries the seed catalogue those 88 cases assert exact prices
     against.

  Under the API model, `src/server/storeApi/contract.ts` holds **every**
  assumption about their endpoints and field names, so reconciling with their
  real spec is a change in one file. Two behaviours there are deliberate:
  recording an analytics event never fails a customer's request (a gap in the
  dashboard beats a shopper who cannot scan), and writes are never retried
  (a timed-out order create may have landed, and retrying could book the
  basket twice).

  Caveat worth stating plainly: **neither durable path has been executed.**
  No database and no retailer API were reachable from the machine they were
  written on. The 88 validation cases prove the in-memory path and the
  refactor that put all three behind one seam; they do not prove the
  integration.
- **Customer login is still client-side**, so the server cannot verify who a
  shopper is. It therefore withholds the 5% member discount rather than
  granting it on a claim anyone can set in devtools; `discount_reason` on the
  order response tells the UI which case it is in. Wiring real customer auth
  means populating `verifiedCustomerId` in `orders/pricing.ts` — nothing else
  in the pricing path changes.
- The backend still needs `orders.customer_user_id` made nullable plus an
  `orders.guest_session_id` column (mirroring the existing `carts` pattern)
  so guest orders have somewhere to live.
- OTP "verification" in `/login` doesn't call a real SMS/auth backend —
  it accepts any 4-digit code, matching the original `AuthScreen.tsx`'s
  behavior (which also never validated against a backend).

## Bugs fixed during development

- The original `useCartStore.ts`'s `removeProduct` returned
  `{ updatedItems, ... }` instead of `{ items: updatedItems, ... }`, so
  removing an item silently did nothing. Fixed in this version.
- `BarcodeScanner.tsx` initially called `listVideoInputDevices()` as a
  static method on `BrowserMultiFormatReader` — it's actually an instance
  method. Fixed after catching it in a real production build.

## Structure

```
src/
├── app/                  # Next.js App Router pages
│   ├── page.tsx          # Gate: Landing choice (first visit) → Home
│   ├── store/[id]/       # Store confirm
│   ├── scan/             # Barcode scanner
│   ├── cart/             # Cart, with Undo-backed removal
│   ├── checkout/         # Guest-or-authenticated payment + discount + QR
│   ├── login/            # Login (reached from Landing or checkout)
│   └── api/              # Session, products, store directory, admin registry
├── components/           # NavBar, LandingChoice, HomeContent, StoreCard,
│                         # BarcodeScanner, ScanToast, DiscountBanner, UndoToast
├── server/               # `import 'server-only'` — never reaches the bundle:
│                         # qr, session, network presence, apiAuth, rateLimit,
│                         # products/ and stores/ (repository + projections)
├── store/                # Zustand: useCartStore, useAuthStore
└── lib/                  # api.ts (typed fetch), useDeviceLocation.ts, upi.ts
```

## Branding

`public/logo.png` is the full brand lockup (bag mark + "SNAP UP" wordmark).
`public/logo-mark.png` is a transparent-background crop of just the bag icon,
trimmed and used in the nav bar at small sizes. `src/app/icon.png` and
`public/icon-512.png`/`apple-touch-icon.png` are generated favicon variants
on a mint background so the mark stays legible at tiny sizes (browser tabs,
home-screen icons).

