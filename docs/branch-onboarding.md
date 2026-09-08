# Branch onboarding — the Kumbakonam pilot

The pilot launches at **one shop**. The registry holds two records and no others.

| id | What it is | Coordinates | Egress range | Status |
| --- | --- | --- | --- | --- |
| `store_1` | Kurinji Metro Bazaar — Kumbakonam, 332 Nageswaran North (+91 89401 00300, key ref `KMB_KUMBAKONAM`) | surveyed | **missing — blocking** | refuses every shopper until its network is registered |
| `store_2` | SnapUp Test — Home Wi-Fi. A bench, not a shop. | deliberately null | a home ISP pool | works |

The other seven Kurinji Metro Bazaar branches — Trichy, two in Thanjavur, Mayiladuthurai,
Pudukkottai, Mannargudi and Natchiarkoil — were removed rather than deactivated. A registry
listing shops the pilot will not serve invites someone to register a network against the
wrong one, and the ids are not stable across that removal: **`store_2` used to mean
Thanjavur East Main and now means the test bench.** Any note, ticket or spreadsheet written
before this change and referring to a store id should be re-read against this table.

If the pilot expands, re-derive the branch list from the retailer directly rather than from
this file or from kurinjimetrobazaar.com — a public website is not an operational source of
truth, and the two Thanjavur shops in particular were worth verifying.

## Why `store_2` has no coordinates

Not an omission. `checkGeofence` treats a null centre as `not_surveyed`, which **defers** to
the network check instead of refusing. Giving the bench the shop's real coordinates would
put a tester at home hundreds of kilometres outside a 50 m fence, and every request would
fail with `outside_store` — a confusing way to discover that the fence works. Unsurveyed
stores are appended to the directory rather than dropped, so it stays visible and usable.

The Wi-Fi check still applies to it in full. The bench is not an open door; it is a store
whose authorised network happens to be a house.

## What still blocks the launch

- `store_1` `egress_cidrs_missing` — **blocking.** The shop's public gateway IP.
- `store_1` opening hours — advisory.

Ask the retailer's ISP whether that gateway address is **static**. If it is dynamic it will
rotate mid-pilot and lock out every shopper at a moment nobody is watching — the bench's own
address moved within an hour of being registered. See `docs/hosting-dns-handoff.md`.

## What has to be collected, per branch

### 1. Coordinates — required for the nearby list

**How:** stand at the shop entrance. Long-press your position in Google Maps, and copy
the decimal degrees it shows (e.g. `10.805500, 78.686700`). Enter them in the admin
console.

**Why it cannot be done from a desk:** geocoding the published address puts the pin
somewhere on the street. That is fine for driving to and useless for ordering two
Thanjavur branches by which one the customer is standing outside.

**Never enter `0`.** It is a real position in the Gulf of Guinea, and a branch seeded
there sorts ~2 000 km from every customer in Tamil Nadu while looking like a genuine
reading. Leave the fields blank — the registry treats blank as "not surveyed" and says
so; it treats `0, 0` as a location.

### 2. Customer Wi-Fi egress IP — **blocking**

**What to ask for:** *"the static public IP address that your customer Wi-Fi traffic
comes out of."* Ask the branch's ISP or whoever installed the network. Enter it as
`a.b.c.d/32`.

**How to check it yourself:** join the branch's customer Wi-Fi on a phone and open
`https://ifconfig.me`. The address shown is the value, provided it is static.

**Why this and not the SSID:** a browser cannot read which Wi-Fi network it is joined
to — no such API exists. Any SSID the app reported would be typed in by the client and
forgeable from a sofa at home. The public source IP is observed by the server and cannot
be set by the customer. The SSID is still recorded, but only to tell the shopper which
network to join.

**Until this is supplied the branch refuses every customer** with
`presence_not_verified`. That is deliberate fail-closed behaviour, not a bug — but it
looks exactly like one from the shop floor, so collect this first.

### 3. Merchant UPI address (VPA)

The shop's own UPI address. Customers pay it **directly**; SnapUp never holds the money
and cannot reverse a payment sent to the wrong address. The format is validated, the
owner is not.

**Send a ₹1 test payment and confirm the retailer received it** before the branch takes
real customers. This is currently the only check that exists.

### 4. Branch API endpoint — only if the branch runs its own system

Ask: **does the chain run one central catalogue system, or does each branch have its
own?**

- **One central system** — leave `apiBaseUrl` and `apiKeyRef` blank on every branch and
  set the platform-wide `SNAPUP_STORE_API_BASE` / `SNAPUP_STORE_API_KEY`. Done.
- **Per branch** — set both fields on each branch, and set the matching environment
  variables in the deployment.

The registry ships with `apiKeyRef` pre-filled per branch on the assumption that per
branch is likely for a chain assembled across six towns. If it turns out to be one
central system, clear those fields — a key reference set without a base URL sends the
call to the platform endpoint, which the console warns about.

#### Environment variables

`apiKeyRef: 'KMB_KUMBAKONAM'` resolves to:

```bash
SNAPUP_STORE_API_KEY_KMB_KUMBAKONAM=...      # the key itself
SNAPUP_STORE_API_BASE_KMB_KUMBAKONAM=https://kumbakonam.example.com/api  # optional
```

The base URL can be set either on the store record (editable in the console, no
redeploy) or as an environment variable. The **key is only ever an environment
variable** — the registry stores a reference to its name, never its value, because the
registry is editable in the console, returned by the admin API, and on Postgres sits in
a table that gets backed up.

If a branch names a key reference the deployment cannot resolve, its calls fail with
`not_configured` rather than falling back to the platform key. Falling back would send
one branch's request authenticated as another, which for a chain where each branch hosts
its own database is a cross-tenant call.

## Testing with your own database

For the pilot you are running the retail database yourselves, so:

1. Point `SNAPUP_STORE_API_BASE` at it and set `SNAPUP_STORE_API_KEY`.
2. Clear `apiKeyRef` on all eight branches (or set the eight per-branch variables to the
   same values — either works).
3. Register a real egress CIDR on at least one branch, or set `PRESENCE_DEV_BYPASS` for
   local testing only.
4. Coordinates can stay blank. The branch works; it just sorts last.

The store *registry* always uses the platform connection regardless of the above —
resolving a branch's endpoint means reading that branch's record, and reading it from
its own endpoint has no base case.

## Onboarding checklist

Copy per branch:

```
Branch: ______________________  id: store___

[ ] Name and address confirmed with the retailer (not just the website)
[ ] Coordinates surveyed at the entrance   ____.______, ____.______
[ ] Customer Wi-Fi SSID                    ______________________
[ ] Egress public IP (static?)             _______._______._______._______/32
[ ] Egress IP verified from the shop Wi-Fi via ifconfig.me
[ ] Merchant VPA                           ______________________
[ ] ₹1 test payment sent and confirmed received
[ ] Own API system?  yes / no
     if yes  base URL  ______________________
             key ref   ______________________  (env var set in deployment)
[ ] Admin console shows no blocking warnings for this branch
```
