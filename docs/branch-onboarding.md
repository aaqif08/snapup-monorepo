# Branch onboarding — Kurinji Metro Bazaar

Eight branches are registered in the store registry with their published names and
addresses. **None of them can serve a customer yet**, and this document is the list of
what has to be collected before any of them can.

The gap is not an oversight. Three of the four things a branch needs cannot be looked
up — they have to be measured at the shop or supplied by the retailer's own IT.

## Status

Run the admin console's Stores page, or check the server log at startup. Every branch
currently reports:

- `egress_cidrs_missing` — **blocking.** Every shopper is refused.
- `coordinates_missing` — advisory. The branch is listed last with no distance.
- `merchant_vpa_missing` — advisory. Checkout falls back to paying at the counter.

## The eight branches

| id | Branch | Address | Phone | Key ref |
| --- | --- | --- | --- | --- |
| `store_1` | Trichy (Kattur) | 60/4 A1C Singaram Nagar, Kattur | +91 63844 11744 | `KMB_TRICHY` |
| `store_2` | Thanjavur East Main | 108, East Main Street | +91 82206 66680 | `KMB_THANJAVUR_1` |
| `store_3` | Thanjavur New Housing Unit | 30, New Housing Unit | +91 96009 00114 | `KMB_THANJAVUR_2` |
| `store_4` | Kumbakonam | 332, Nageswaran North | +91 89401 00300 | `KMB_KUMBAKONAM` |
| `store_5` | Mayiladuthurai | 11, Pattamangala Street | +91 81100 00738 | `KMB_MAYILADUTHURAI` |
| `store_6` | Pudukkottai | 1319, North Main Street | +91 74184 33354 | `KMB_PUDUKKOTTAI` |
| `store_7` | Mannargudi | 60, Kaasukara Street | +91 98944 30533 | `KMB_MANNARGUDI` |
| `store_8` | Natchiarkoil | 840/1, Main Road | +91 82200 05728 | `KMB_NATCHIARKOIL` |

Transcribed from kurinjimetrobazaar.com. Confirm against the retailer before go-live —
a public website is not an operational source of truth, and `store_2`/`store_3` being
two separate Thanjavur shops in particular is worth verifying.

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

`apiKeyRef: 'KMB_TRICHY'` resolves to:

```bash
SNAPUP_STORE_API_KEY_KMB_TRICHY=...      # the key itself
SNAPUP_STORE_API_BASE_KMB_TRICHY=https://trichy.example.com/api   # optional
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
