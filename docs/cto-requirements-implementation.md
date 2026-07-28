# CTO Requirements — Implementation & Validation

Maps each requirement from *CTO Requirement's Solution [Detailed Report]* onto the code
that implements it and the test that demonstrates it.

**Read the "Deviation" section first.** One requirement could not be built as written.

## Reproducing the evidence

Every result in this document is produced by a single command:

```bash
npm run validate
```

`scripts/validate-requirements.mjs` builds the app, starts a **production** server, runs
all 48 cases below against it over real HTTP, prints a pass/fail line per case, and exits
non-zero if any case fails. Case IDs (`R1.1`, `R2.4`, …) are cited in the tables that
follow, so any claim here can be traced to the check that proves it.

Two details make the run meaningful rather than ceremonial:

- It runs against a **production build**, so `SNAPUP_PRESENCE_DEV_BYPASS` is ignored and
  the genuine egress-IP presence check executes. Nothing is stubbed.
- The harness sets `x-forwarded-for` itself, standing in for the single trusted proxy that
  fronts the app in deployment. That is what allows a customer inside the store, at home,
  and actively spoofing the header to be simulated from one machine.

The suite is verified to actually fail: reverting `getEgressIp()` to a naive leftmost read
of `x-forwarded-for` makes R1.8 fail (a session is minted from the spoofed IP), and adding
`cost_price` back to the projection makes R2.3, R2.4 and R4.3 fail.

---

## Deviation from the report: Wi-Fi verification (Requirement 1, Factor 2)

The report specifies presence factor 2 as **"Authorized SSID"** verification.

**This cannot be built in a web application, and should not be promised to the CTO in its
current wording.** No browser exposes the connected Wi-Fi SSID to a web page — there is no
such API, in any browser, and its absence is a deliberate privacy decision rather than a
gap that will be filled later. The only way an SSID could reach our backend is if the app
*told* us, and the app runs on the customer's device. A customer at home would change one
value in one request and pass the check. Factor 2 would then be decorative, and the
report's own validation case — *"Customer outside store → Database access denied"* — would
fail against anyone who opened developer tools.

**What was implemented instead: server-side egress IP verification.**

Every supermarket's customer Wi-Fi reaches the internet through a NAT gateway with a known
public IP. Our server observes the true source IP of each request. Requests from inside the
store carry the store's gateway IP; requests from a customer's home carry their ISP's. The
customer's device is not consulted and cannot influence the value.

This is strictly stronger than the SSID check as specified:

| | Client-reported SSID | Server-observed egress IP |
|---|---|---|
| Who asserts it | The customer's device | Our own infrastructure |
| Forgeable from home | Yes, trivially | No |
| Survives devtools | No | Yes |

It also makes *"database communication terminates when the customer leaves"* fall out for
free. The session token is signed with the egress IP baked into it, so when the customer
steps onto cellular data their IP changes, the binding breaks, and every subsequent API
call is rejected — with no session store to maintain and no cleanup job to run.

### Suggested replacement wording for the report

> **Presence Verification Factor 2 — Store Network Verification**
>
> Immediately after successful QR validation, the backend verifies that the customer's
> request originates from the supermarket's authorized network. Verification is performed
> **server-side** against the store's registered public network range; it is not
> self-reported by the customer's device and therefore cannot be forged from outside the
> store.
>
> Verification includes:
> - Authorized store network range (registered per store)
> - Network origin validation
> - Store identifier association
>
> Only after successful network verification shall database communication be enabled.

### Operational requirement this creates

Each participating store must supply **the static public IP of its customer Wi-Fi NAT
gateway**, registered in `apps/customer-web/src/server/stores.ts`. This is the one piece
of information the supermarket has to provide before a pilot. Two caveats worth raising
with them up front:

- If a store's connection uses a **dynamic** IP, it needs a static one (routine for a
  business line) or we fall back to a small allowlisted range.
- A customer on **cellular data while standing inside the store** will be refused, because
  their traffic does not traverse the store network. This is correct behaviour under the
  CTO's requirement — presence is proven *by* being on the store network — but it is a
  real customer-experience consequence and staff should know to tell shoppers to connect
  to the store Wi-Fi.

---

## Requirement 1 — Secure Dual Presence Authentication

| Deliverable | Implementation |
|---|---|
| Dynamic QR generation | `src/server/qr.ts` → `issueEntryQr()`, served by `GET /api/store/[id]/entry-qr` |
| QR signature validation | `src/server/qr.ts` → `validateEntryQr()` (HMAC-SHA256, fixed algorithm) |
| Wi-Fi verification | `src/server/network.ts` → `verifyNetworkPresence()` (see deviation above) |
| Secure session creation | `src/server/session.ts` → `createSession()`, only from `POST /api/session/start` |
| Session expiry management | 30-minute cap, `SESSION_TTL_SECONDS` in `src/server/env.ts` |
| Session heartbeat | `POST /api/session/heartbeat`, client timer in `src/app/scan/page.tsx` |
| Automatic session termination | Egress IP bound into the session signature — `validateSession()` |
| Database access restriction | `guardProductRequest()` in `src/server/apiAuth.ts`, on every product route |

The entrance QR carries store id, a rotating nonce, issued-at, a 120-second expiry, an
HMAC signature and a token version. The short TTL is what makes a photographed QR
worthless; the egress IP check is what makes a *stolen live* QR worthless.

Tokens are **not JWT**, deliberately: JWT's negotiable `alg` header is a well-known
downgrade vector (`alg: none`), and we control both ends, so a fixed HMAC has strictly less
attack surface.

### Validation evidence

All cases from the report's validation plan, plus positive controls. Reproduce with
`npm run validate`.

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| R1.1 | QR + store network | Access granted | `201` + session token |
| R1.2 | Valid QR, customer at home | Denied | `403 presence_not_verified` |
| R1.3 | Store network, invalid QR | Denied | `401 qr_bad_signature` |
| R1.4 | Photographed QR (10 min old), on store network | Denied | `401 qr_expired` |
| R1.5 | Attacker-minted QR (wrong secret) | Denied | `401 qr_bad_signature` |
| R1.6 | Session valid, then customer walks out | Session terminated | `403 presence_lost` |
| R1.7 | Heartbeat from outside store | Session inactive | `{"active": false, "reason": "presence_lost"}` |
| R1.8 | Spoofed `x-forwarded-for` claiming store IP | Denied | `403 presence_not_verified` |
| R1.9 | Heartbeat inside store | Session active | `{"active": true}` |
| R1.10 | Session lifetime | Capped at 30 min | `1800s` |
| R1.11 | Entrance QR lifetime | Rotates on 120s TTL | `rotate_after_seconds = 120` |
| R1.12 | Customer ends session, then requests a product | Denied | `401 revoked` |

R1.9 and R1.10 are positive controls: without them, a build that denied *every* request
would pass the whole table.

That last case is worth highlighting to the CTO: `x-forwarded-for` is a client-settable
header, so a naive implementation that trusts its leftmost entry hands out sessions to
anyone who sets it. `getEgressIp()` counts from the right, taking only the entry appended
by infrastructure we control (`SNAPUP_TRUSTED_PROXY_HOPS`).

---

## Requirement 2 — Secure Server-Side Database Gateway

**The reported issue was real.** The product database was defined in
`src/lib/mockData.ts` as `MOCK_PRODUCT_DB` and imported directly by the scanner page — a
client component. The entire catalogue was compiled into the browser bundle and readable
by anyone who opened devtools.

The catalogue now lives in `src/server/products/`, every module of which begins with
`import 'server-only'`. That is a build-time guarantee, not a convention: importing any of
it from a client component fails the build outright, so this cannot silently regress.

| Control | Implementation |
|---|---|
| Authenticated requests only | `guardProductRequest()` — no session, no data |
| Active shopping session required | `validateSession()` on every request |
| Store-scoped access | Store id read from the **signed session**, never a query param |
| Single product lookup | `GET /api/products/barcode/[barcode]` returns exactly one item |
| No bulk export endpoints | No such route exists; `page_size` hard-capped at 50 |
| Rate limiting | `src/server/rateLimit.ts`, token bucket per session |
| Least-privilege responses | `toPublicProduct()` in `src/server/products/projection.ts` |
| Request validation | Barcode pattern `^\d{6,14}$`, integer-parsed pagination |

The projection is an **allowlist by construction** — fields are copied out one at a time
rather than spread-and-deleted. A `{...product, cost_price: undefined}` projection leaks
every new column somebody adds to the table six months from now; this one cannot, because
a new field is simply never copied.

| Returned to customer | Never leaves the server |
|---|---|
| `id`, `barcode`, `name`, `unit_price`, `image_url`, `expected_weight_grams` | `cost_price`, `profit_margin_pct`, `supplier_name`, `supplier_contact`, `stock_quantity`, `internal_sku`, `purchase_history` |

### Validation evidence

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| R2.1 | Unauthenticated product request | Denied | `401 missing_token` |
| R2.2 | Tampered session token | Denied | `401 bad_signature` |
| R2.3 | Product response field set | Exactly 6 permitted fields | `id, barcode, name, unit_price, image_url, expected_weight_grams` |
| R2.4 | All 7 internal columns + sample values, across single **and** search responses | Never present | zero occurrences |
| R2.5 | `?page_size=100000` | Hard-capped | `page_size: 50` |
| R2.6 | Bulk export endpoint | Does not exist | `/api/products` → `404` |
| R2.7 | store_2 session requests a store_1-only item | Denied | `404 product_not_found` |
| R2.8 | Same barcode under each store's session | Per-store pricing | ₹40.00 vs ₹42.00 |
| R2.9 | `?store_id=store_1` under a store_2 session | Parameter ignored | store_2 price returned |
| R2.10 | Malformed barcode | Rejected before lookup | `400 invalid_barcode` |
| R2.11 | 60 rapid product reads on one session | Throttled | 40 served, 20 × `429` |

R2.8 is the load-bearing one: identical barcode, different price per store, so a
regression in scoping shows up as a wrong number rather than as a silent success. R2.9
closes the matching hole — a client-supplied `store_id` must never override the signed
session.

Separately, the built client bundle was grepped for `cost_price`, `internal_sku`,
`profit_margin`, `supplier_contact`, `supplier_name`, `purchase_history`,
`stock_quantity` and both signing secrets — **zero hits**. That check covers the bundle at
rest; R2.4 covers the wire at runtime.

---

## Requirement 3 — High-Speed Barcode Retrieval (~2s target)

| Deliverable | Implementation |
|---|---|
| Indexed lookup | `Map` keyed `store_id:barcode` — O(1), `memoryRepository.ts` |
| API timing measurement | `performance.now()` around the lookup; `lookup_ms` in the body |
| Client cache | 5-minute session-scoped cache in `src/lib/api.ts` |
| Response timing display | `LookupTiming` component on the scan screen |
| Performance logging | `Server-Timing: lookup;dur=…` header on every product response |

### Validation evidence

Five consecutive scans against a production server (case R3.1 — the harness re-measures and
re-prints this table on every run, so these figures are a sample rather than a fixed claim):

| Scan | End-to-end | Server DB lookup |
|---|---|---|
| 1 | 2.1 ms | 0.07 ms |
| 2 | 1.7 ms | 0.06 ms |
| 3 | 2.3 ms | 0.10 ms |
| 4 | 2.1 ms | 0.09 ms |
| 5 | 2.2 ms | 0.07 ms |

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| R3.1 | Five consecutive scans | Each under 2000 ms | slowest 2.3 ms |
| R3.2 | Timing observability | `Server-Timing` header present | `lookup;dur=0.08` |
| R3.3 | Timing in payload | `lookup_ms` numeric | `0.1` |

Against a 2000 ms target, with roughly three orders of magnitude of headroom. The database
lookup itself is ~0.1 ms, so effectively the entire budget is network round-trip — which
is where the client cache and the small projected payload do their work. The scan screen
shows the live figure so the target can be validated in the room rather than taken on
trust, and flags red if a lookup ever exceeds 2000 ms.

R3.1 asserts the **slowest** of the five, not the mean, so one slow outlier cannot be
averaged away.

Note these numbers come from an in-memory repository over loopback, which removes both
network latency and real database cost. A real database over a real network will be
slower — expect single-digit to low-tens of milliseconds for an indexed lookup, still far
inside target. The harness measures the architecture, not the eventual production latency.

---

## Requirement 4 — Database Retrieval Optimization

| Deliverable | Implementation |
|---|---|
| Paginated APIs | `GET /api/products/search?q=&page=&page_size=` |
| Search index | Pre-sorted per-store lists + O(1) barcode map |
| Cache layer | Client cache + `Cache-Control: private, max-age=60` |
| Optimized response objects | Projection strips 7 of 13 fields |
| Scalable endpoint architecture | `ProductRepository` interface |

The `ProductRepository` interface in `src/server/products/types.ts` is the part that
actually answers *"supports future enterprise-scale deployment without fundamental
redesign"*. No calling code imports the concrete implementation — only the interface. To
move to Postgres:

1. Write `PostgresProductRepository implements ProductRepository` (three methods).
2. Change one export line in `src/server/products/index.ts`.

The barcode map becomes `CREATE UNIQUE INDEX ON products (store_id, barcode)`, and the
in-memory slice becomes `LIMIT/OFFSET`. No route, no component, and no auth code changes.

`Cache-Control` is `private`, never `public`: these responses are scoped to one store's
pricing under one customer's session and must never reach a shared CDN cache.

### Validation evidence

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| R4.1 | `?page=1&page_size=5` | Paginated with metadata | 5 of 12 items, `page: 1` |
| R4.2 | Page 1 vs page 2 | No overlap | disjoint id sets |
| R4.3 | Every search result | Same 6-field projection as single lookup | all items projected |
| R4.4 | Product `Cache-Control` | `private`, never `public` | `private, max-age=60` |
| R4.5 | `?q=maggi` | Filters server-side | 1 of 12 |

R4.3 matters because search is the easy place for a projection to be forgotten: the single
lookup is the obvious path to protect, and a bulk-shaped endpoint that skipped
`toPublicProduct()` would leak the whole catalogue's internals at once. R4.4 asserts the
absence of `public` explicitly, not just the presence of `private`.

---

## Store directory, device location and the admin registry

Added after the four requirements above, so numbered separately. Two problems were solved
together, because they are the same problem seen from each end: customers need to find the
stores where SnapUp works, and someone has to decide which stores those are.

### What changed

The store list used to be `MOCK_STORES` in `src/lib/mockData.ts`, with **hardcoded
`distanceKm` values**. Every shopper was told DMart was 1.2 km away regardless of where
they actually stood. There were also two separate store registries — that mock list, and
the server-side one holding the egress CIDRs — which could disagree.

There is now one registry, `src/server/stores/`, holding location *and* network
registration together. That pairing is the important part: a store's coordinates decide
where it appears in the directory, and its egress CIDR decides whether anyone there can
actually shop. Splitting them across two places is how a store ends up listed and broken.

| Concern | Implementation |
|---|---|
| Device location | `src/lib/useDeviceLocation.ts` — permission-aware, high-accuracy |
| Distance calculation | `src/server/stores/geo.ts` — haversine, computed **server-side** |
| Customer directory | `GET /api/stores/nearby?lat=&lng=&radius_km=` |
| Admin registry API | `GET/POST /api/admin/stores`, `PATCH /api/admin/stores/[id]` |
| Admin credential | `src/server/adminAuth.ts` — constant-time compare |
| Admin console | `apps/admin-web` → `/stores`, proxied via its own `/api/stores` |

### Two decisions worth the CTO's attention

**Location is requested, never assumed.** The browser is asked through the Permissions API
first, so a customer who already granted access is not re-prompted and one who declined is
not nagged on every visit. Declining is a supported state, not a broken one: the directory
still works, just unordered and without distances. It does not invent a distance, which is
what the old hardcoded values effectively did.

**The admin credential never reaches a browser.** `apps/admin-web` is a client-side app, so
it proxies through its own server routes; the token lives only in
`apps/admin-web/src/server/snapupApi.ts`. This matters more than a normal API key would,
because a store record carries the egress ranges the presence check trusts — write access
to the registry is effectively the ability to authorise a network. An attacker who could
add their own IP to a store could grant themselves sessions from anywhere. Shipping that
token in a bundle would be the same mistake Requirement 2 was raised about, pointed at a
more sensitive target.

### Validation evidence

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| R5.1 | No location shared | Directory still works, no distances | 5 stores, no `distanceKm` |
| R5.2 | Coordinates at HSR Layout | Real distances, nearest first | `store_1` at 0.0 km, ascending |
| R5.3 | Same request from Jayanagar | Ordering follows the device | `store_5` nearest |
| R5.4 | `radius_km=2` vs `100` | Filters by radius | 1 store vs 5 |
| R5.5 | 4 malformed coordinate inputs | Rejected | `400 invalid_coordinates` |
| R5.6 | Public directory contents | No network ranges | no CIDR data present |
| R5.7 | Directory `Cache-Control` | `private`, never `public` | `private, max-age=30` |
| R6.1 | Registry write, no credential | Denied | `401 missing_token` |
| R6.2 | Registry write, wrong credential | Denied | `403 invalid_token` |
| R6.3 | Admin registers a store | Created | `201`, `store_6` |
| R6.4 | Customer directory afterwards | Store present, no redeploy | listed and nearest |
| R6.5 | Session at the new store | Works | `201` |
| R6.6 | Malformed CIDR (`10.0.0.1`, `999.1.1.1/32`) | Rejected | `400 invalid_store` |
| R6.7 | Store saved with **no** network | Warned, and fails closed | warning + `403 presence_not_verified` |
| R6.8 | Store deactivated | Withdrawn everywhere | hidden from directory, entry QR `404` |
| R6.9 | Admin listing | Shows CIDRs the customer view hides | `198.51.100.24/32` |
| R6.10 | Patch an unknown id | Rejected | `404 store_not_found` |

R5.3 is the one that makes R5.2 meaningful: a fixed list would satisfy "nearest first"
by luck from one vantage point, so the same query is issued from a second location and the
ordering has to change. R6.7 is the operational safety case — a store registered before its
gateway IP is known refuses every customer rather than admitting every customer, and the
console says so at the point of saving rather than leaving it to be discovered in the shop.

**A bug this suite caught.** The first run failed R5.5: `?lat=12.9` with no `lng` returned
`200` instead of `400`. `Number(null)` is `0`, not `NaN`, so a missing longitude was being
read as a *valid* longitude of zero — answering as though the customer were in the Gulf of
Guinea and returning an empty list that reads as "no stores near you" rather than an error.
Fixed in `parseCoordinate()`.

---

## Configuration

| Variable | Purpose |
|---|---|
| `SNAPUP_QR_SECRET` | HMAC secret for entrance QR codes. **Required in production.** |
| `SNAPUP_SESSION_SECRET` | HMAC secret for session tokens. **Required in production.** |
| `SNAPUP_ADMIN_API_TOKEN` | Credential for the store-registry write API. **Required in production.** Must match on both apps. |
| `SNAPUP_API_BASE` | *(admin-web)* Where the customer app's API lives. Default `http://localhost:3000`. |
| `SNAPUP_TRUSTED_PROXY_HOPS` | Proxies appending to `x-forwarded-for`. Default `1` (correct for Vercel). |
| `SNAPUP_PRESENCE_DEV_BYPASS` | `1` skips the egress IP check. Dev only — **ignored in production builds**. |

None of these carry a `NEXT_PUBLIC_` prefix, and that is load-bearing rather than
stylistic: the prefix is what inlines a value into the client bundle.

All three secrets fail closed: a production build that cannot find them refuses to start
rather than falling back to a default, since a known default would make every signature in
the system forgeable by anyone who has read this repository.

Local development needs the bypass, because a loopback request has no meaningful public IP:

```bash
SNAPUP_PRESENCE_DEV_BYPASS=1 npm run dev:customer
```

---

## Known limitations to raise before pilot

Honest gaps, none of which are hidden by the tests above:

1. **Rate limiting is per-instance.** `rateLimit.ts` uses process memory, so under
   serverless fan-out the effective limit is roughly capacity × instance count. Fine for a
   POC; a pilot should move it to Redis / Vercel KV for a global limit.
2. **Session revocation is best-effort.** `revokeSession()` is also per-instance memory, so
   another instance may not know a token was revoked. The IP binding and the 30-minute
   expiry are the real boundary and hold regardless — but explicit logout is not
   instantaneous across instances.
3. **The QR nonce is not single-use.** Within its 120-second window a code can be
   presented more than once. Closing this needs shared storage; the practical impact is
   low because factor 2 still requires the attacker to be on the store network.
4. **Store egress IPs are placeholders.** `src/server/stores/seed.ts` contains RFC 5737
   documentation addresses. Real values must be registered before any pilot or every
   customer is denied. The admin console now flags these explicitly on save, so the
   problem is visible rather than latent — but it is still unresolved data.
5. **The product catalogue and store registry are in-memory.** Deliberate, per the
   repository-interface design above, but it means data resets on deploy and does not
   survive across instances. For the registry this is sharper than for the catalogue: a
   store an admin adds today is gone after the next deploy, and under serverless fan-out
   one instance may not know about a store another instance just created. **This is the
   first thing to move to Postgres** — the `StoreRepository` interface exists precisely so
   that swap touches nothing else.
6. **The admin API uses a single shared token.** It authenticates the admin *application*,
   not an individual operator, so registry changes cannot be attributed to a person and
   the credential cannot be rotated per user. Adequate for a POC with one console; a pilot
   wants per-operator identity and an audit trail on a surface that controls which
   networks are trusted.
7. **The discount is granted on a client-side flag.** Unrelated to the requirements above,
   but worth recording: `checkout/page.tsx` reads `isAuthenticated` from `localStorage`, so
   anyone can set it in devtools and take the logged-in discount without logging in. Login
   is mocked and no payment is captured, so it is harmless today — but it becomes a live
   discount-fraud path the moment checkout is real. The fix is the same shape as the
   presence work: compute totals server-side from a verified identity.
