# Branch onboarding — the Kumbakonam pilot

The pilot launches at **one shop**. The registry holds two records and no others.

| id | What it is | Coordinates | Egress range | Status |
| --- | --- | --- | --- | --- |
| `store_1` | Kurinji Metro Bazaar — Kumbakonam, 332 Nageswaran North (+91 89401 00300, key ref `KMB_KUMBAKONAM`) | surveyed | **missing — blocking** | refuses every shopper until its network is registered |
| `store_2` | SnapUp Test — Home Wi-Fi. A bench, not a shop. | surveyed (Kelambakkam) | a home ISP pool | works |

The other seven Kurinji Metro Bazaar branches — Trichy, two in Thanjavur, Mayiladuthurai,
Pudukkottai, Mannargudi and Natchiarkoil — were removed rather than deactivated. A registry
listing shops the pilot will not serve invites someone to register a network against the
wrong one, and the ids are not stable across that removal: **`store_2` used to mean
Thanjavur East Main and now means the test bench.** Any note, ticket or spreadsheet written
before this change and referring to a store id should be re-read against this table.

If the pilot expands, re-derive the branch list from the retailer directly rather than from
this file or from kurinjimetrobazaar.com — a public website is not an operational source of
truth, and the two Thanjavur shops in particular were worth verifying.

## The test bench, and what its geofence proves

`store_2` is surveyed at a house near Kelambakkam and runs the same 50 m fence as the shop,
so the bench rehearses the real thing rather than a relaxed version of it. Measured against
the live deployment:

| Reading sent | Result |
| --- | --- |
| at the bench, ±10 m | session granted |
| 200 m away, ±10 m | `outside_store` — "about 200 m from…" |
| 200 m away, ±120 m | granted — the reading is vaguer than the fence, so it defers |
| no position at all | granted — defers |
| the Kumbakonam shop's position | `outside_store` — 226,654 m |

The two deferrals are the design, not a hole. A fence is a filter on honest mistakes, never
a security control — the position comes from the customer's own browser and anyone with
developer tools can claim to stand at the till. The control that holds is the network check,
which the server observes on the connection and the page cannot assert.

**The one case that will refuse you wrongly** is a browser reporting a confident position
that is wrong, which laptop Wi-Fi geolocation does routinely. Test on a phone. If a laptop
must be used, widen the bench's radius rather than deleting its coordinates:

```sql
UPDATE stores SET geofence_radius_m = 500 WHERE id = 'store_2';
```

Its coordinates and egress range are not in `seed.ts`. They describe a house, not the
software, and the next person to run a bench has a different house and a different ISP
lease — a hard-coded pair would quietly point their fence at the last person's address.

## Entrance codes: display or poster

Two ways in, and they are not equivalent.

| | `/entrance/<store_id>` | `/poster/<store_id>` |
| --- | --- | --- |
| Needs | a screen, power and network at the door | a printer |
| Code lifetime | 120 s, rotating | 2 years |
| Presence factors | QR **and** network | network only, in practice |

**One QR cannot both join the Wi-Fi and start a session.** A Wi-Fi code carries a `WIFI:`
URI the camera hands to network settings; a session code carries an https link it hands to
the browser. There is no payload that is both, so the poster shows two codes and numbers
them. Joining must happen first — the session link fails with "connect to the store Wi-Fi"
if it is scanned on mobile data, which a shopper scanning right-to-left will hit before
doing anything wrong.

**Scan the poster with the phone's own camera app, not the Snap Up scanner.** A `WIFI:`
code is handled by the operating system and an https link by the browser; neither is
something an in-app scanner can act on. The poster says so in black on white, because the
first person to test one scanned both codes inside the app and got a network error for
their trouble. Scanning them in the app now gives a useful message instead.

**The printed code is a pointer, not a credential.** `/p/<8 characters>` identifies the
shop; `/p/[code]` mints a fresh two-minute entry token when it is scanned. So a photograph
of the poster is a photograph of a store id, and both presence factors survive — the
earlier design printed a two-year token, which threw that away.

Keep the printed URL short. The first version printed the whole signed token, 240
characters, which is a 61x61 QR: about three pixels per module on screen, and the in-app
scanner crops and decodes at 400px, so barely more than one. It did not scan at all, and a
code that will not scan looks exactly like a broken camera to the person holding the phone.

**The shop Wi-Fi has to reach the internet.** The app is hosted; joining a network that
cannot route to it produces a browser error about the connection, which reads as an app
fault. A captive portal that demands a click-through will do the same.

**The Wi-Fi password is typed into the poster page, not stored.** A Wi-Fi QR contains the
password in plain text by design; keeping it in the database to render a sheet printed once
would put it in backups and logs. It is encoded in the browser and the input is hidden when
printing. Print the sheet, close the tab.

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
2. Clear `apiKeyRef` on `store_1` (or set `SNAPUP_STORE_API_KEY_KMB_KUMBAKONAM` to the same
   value — either works). The bench has no `apiKeyRef` to clear.
3. Register a real egress CIDR on at least one store. `store_2` already has one, which is
   the point of it — never set `PRESENCE_DEV_BYPASS` on anything deployed.
4. Coordinates can stay blank. The store works; it just sorts last and runs no fence.

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
