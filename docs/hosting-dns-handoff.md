# Hosting & DNS handoff — the pilot environment

Written against **Snap Up — Intern Hosting & DNS Handoff Guide**. Read `deployment.md`
first for what each environment variable does; this covers where things go and what to
send back.

---

## The architecture in the guide is not the architecture of this repository

The guide asks for a frontend on Vercel and a **separate backend/API on Railway**, joined
by `NEXT_PUBLIC_API_URL`. Snap Up is not built that way, and deploying it as though it were
would mean a refactor rather than a deployment.

| Guide | This repository |
| --- | --- |
| Frontend (Vercel) | `apps/customer-web` — the shopper UI **and** every API route, one Next.js app |
| Backend / API (Railway) | Does not exist as a separate service |
| — | `apps/admin-web` — the business console, a second Next.js app |

`apps/customer-web/src/app/api/**` is the API. Presence checks, sessions, pricing, payment,
the exit gate and the staff endpoints are all Next.js route handlers inside the same
project that serves the shopper's screens. There is no server to lift out and put on
Railway without splitting the application in half.

**Recommended mapping**, which gives the owner the two hostnames the guide asks for
without changing the application:

| Hostname | Points at |
| --- | --- |
| `dev.snapup.astradyneglobal.com` | `apps/customer-web` — shopper app |
| `api-dev.snapup.astradyneglobal.com` | `apps/customer-web` — the same Vercel project, second domain. Its API *is* the API. |
| a third hostname, or the Vercel preview URL | `apps/admin-web` — the console, used by staff at the exit |

Vercel supports multiple domains on one project, so `api-dev` is an alias rather than a
second deployment. Both hostnames then serve the same routes; the split is naming, which is
what the DNS handoff actually needs.

### If Railway is required anyway

The one genuine argument for it is that Railway runs a persistent container with a real
filesystem, so the embedded PGlite database would work there and cannot work on Vercel —
Vercel's filesystem is read-only and its instances are ephemeral. That argument disappears
the moment `DATABASE_URL` points at Neon, which it should for the pilot regardless. See
"The database question" below.

Splitting the API out to satisfy the topology would mean extracting every route handler
into a standalone server, re-implementing the account cookie across two origins, and
introducing the CORS surface that currently does not exist. That is not a two-day change
and it would weaken the security model, so it is not recommended for the pilot.

---

## Deploying the backend to Railway

`railway.json` at the repository root configures it. Railway reads it automatically on
first deploy.

```json
build.buildCommand   npm ci && npm run build:customer
deploy.startCommand  npm run start:customer
deploy.healthcheckPath  /api/health
```

Three things about that configuration are load-bearing:

**`npm ci` runs at the repository root**, not inside the app. This is an npm-workspaces
monorepo and `apps/customer-web` depends on `@snapup/ui` by workspace reference —
installing from the app directory cannot resolve it. Set Railway's root directory to the
repository root, not to `apps/customer-web`.

**No port is passed.** Railway assigns one at runtime and `next start` reads `PORT` from
the environment itself. Passing `-p ${PORT:-3000}` looks more explicit and breaks: npm
hands script arguments to the platform shell, cmd.exe does not expand that syntax, and
Next.js receives the literal string and refuses to start. Verified working by running the
production server on an arbitrary port with `PORT` set.

**The health check answers 200 whenever the process is serving.** A shop with no gateway IP
registered is not a failed deployment, and a probe that failed on unfinished configuration
would restart a working container forever. Read `pilot_ready` in the body for readiness;
the status code is about the process.

`railway.json` is the Config-as-Code format, which Railway has deprecated in favour of
`.railway/railway.ts` — supported until 2026-12-01, comfortably past this pilot. The
migration was attempted and abandoned: the IaC engine requires a globally installed CLI to
evaluate the file, and shipping configuration that cannot be validated locally is worse
than shipping a supported format that can. `railway config migrate --apply` performs the
conversion when someone has the CLI installed properly.

### Deploying

```bash
railway login                 # interactive; opens a browser
railway link                  # attach to the project
railway up                    # build and deploy
railway domain                # add api-dev.snapup.astradyneglobal.com, then copy the DNS records
```

**`SNAPUP_TRUSTED_PROXY_HOPS=2` on Railway, not the default 1.** Railway appends its own
internal proxy to `x-forwarded-for`, so the right-most entry is Railway's address rather
than the shopper's. Left at `1`, every session binds to `152.233.15.120` and presence
refuses every shopper — a failure that looks like a misconfigured store rather than a
misconfigured platform. See `deployment.md` §7 for how to measure this on a new host.

Set every environment variable from the customer-app list below in Railway's dashboard
before the first deploy — the app refuses to start without the six signing secrets rather
than sign tokens with development defaults, and a container that exits immediately reads as
a build problem rather than a missing variable.

### What was verified on the live deployment

Run against `https://snapup-monorepo-production.up.railway.app` with Neon behind it, the
presence check on, and no spoofed headers — i.e. the real journey, not a local rehearsal:

```
1. session: presence + geofence passed, bound to 49.37.212.85, 1800s TTL
2. scanned SNAP0000000001 from Neon: India Gate Classic Basmati Rice 1 kg @ Rs 210.00
3. bill: items Rs 600.00 (saved Rs 30.00) + fee Rs 60.00 - disc Rs 0.00 = Rs 660.00
   GST Rs 28.56 shown inside, never added  |  guest: fee charged
   payee ASTRADYNEGLOBAL1789@iob (Astra Dyne Global), weight 3000g
4. payment: awaiting_verification, confirmation customer_attested,
   exit_token null, payment_verified false, staff code BT5JDH
5. health: db=postgres accounts_durable=true presence_bypass=false pilot_ready=false
```

Step 4 is the design working, not a failure. A customer's own word that they paid is
`customer_attested`, which is below the bar for opening the gate, so no exit token is minted
and the basket goes to the staff desk with a short code instead.

The exit desk itself — scale comparison and staff approval — is guarded by a console
session rather than the machine token, so closing that last leg needs a real staff account.
It is verified locally and is the one step not exercised against production, because
creating a staff login in the pilot database to prove a point is not a fair test.

`pilot_ready: false` reflects platform warnings (per-instance rate limits, log-only OTP
and reset delivery), not the store registry — it never inspects stores at all.

---

## What to configure in Vercel

Both apps live in one repository, so each Vercel project needs its **Root Directory** set —
this is the setting people miss, and its symptom is a build that cannot find `next`.

| Project | Root Directory | Build |
| --- | --- | --- |
| snapup-customer | `apps/customer-web` | default (`next build`) |
| snapup-admin | `apps/admin-web` | default |

`vercel.json` files were deliberately removed from both apps — they broke the build. Region
(`bom1`, Mumbai) is set in the dashboard instead. It matters: without it, requests from
Tamil Nadu cross to whichever region Vercel defaults to, which costs roughly a quarter of a
second against a ~2 second scan budget.

### Environment variables — customer app

Six secrets are fatal if missing; the app refuses to start rather than sign tokens with a
development default.

```
SNAPUP_QR_SECRET
SNAPUP_SESSION_SECRET
SNAPUP_EXIT_TOKEN_SECRET
SNAPUP_ADMIN_API_TOKEN
SNAPUP_ACCOUNT_SECRET
SNAPUP_OTP_PEPPER
SNAPUP_CREDENTIAL_SECRET     encrypts branch API keys and Wi-Fi passwords at rest
DATABASE_URL                 Neon, pooled endpoint, sslmode=require
SNAPUP_TRUSTED_PROXY_HOPS=1  Vercel is one proxy in front of the app; on Railway this is 2
```

Two more that must be set deliberately, because their production defaults throw:

```
SNAPUP_OTP_DELIVERY=log      'sms' is the default in production and throws without MSG91
SNAPUP_RESET_DELIVERY=log    'email' is the default and throws without a mail provider
```

Customers sign in with a username and password, so neither affects shoppers. `log` only
means staff cannot sign in to the console *by phone* — email and password still work.

### Environment variables — admin console

```
SNAPUP_API_BASE=https://api-dev.snapup.astradyneglobal.com
SNAPUP_ADMIN_API_TOKEN        the same value as the customer app
```

**`SNAPUP_API_BASE` must not be renamed to `NEXT_PUBLIC_API_URL`.** The guide asks for the
project's existing variable to be used, and this is it — but the prefix matters beyond
naming. `NEXT_PUBLIC_*` is inlined into the browser bundle, and this variable is read
alongside `SNAPUP_ADMIN_API_TOKEN` in server-side code only. Making it public would put a
machine credential one "view source" away.

The console never calls the API from a browser. `server/authProxy.ts` fetches
server-to-server and relays the session cookie onto its own origin, which is why the
account cookie works across two hostnames at all.

---

## CORS

**Not required, and should not be added.**

Every client-side `fetch` in both apps is a relative, same-origin path. The only
cross-origin traffic is the console's server-to-server call to the gateway, which is not
subject to CORS. Adding `Access-Control-Allow-Origin` would open the API to browser calls
from other origins for no benefit — the guide's checklist item does not apply to this
topology.

---

## The database question

Do not run the pilot on the embedded database.

PGlite is real PostgreSQL compiled to WebAssembly, and it is excellent for development
because it needs nothing installed. It has two properties that disqualify it here:

- **Vercel cannot run it.** The filesystem is read-only and instances are ephemeral.
- **It cannot survive an ungraceful stop.** A hard kill or a power cut mid-write leaves
  `PANIC: could not locate a valid checkpoint record`, and PGlite ships no `pg_resetwal`.
  This happened twice during development from nothing worse than stopping a dev server, and
  a power cut at the shop does the same thing.

Point `DATABASE_URL` at Neon's **pooled** endpoint with `sslmode=require`. The code selects
the Neon driver automatically for any non-`file:` URL — no code change.

---

## The two stores in the pilot database, and a warning about dynamic IPs

| id | Store | Egress range | Purpose |
| --- | --- | --- | --- |
| `store_1` | Kurinji Metro Bazaar — Kumbakonam | **empty** | the pilot shop |
| `store_2` | SnapUp Test — Home Wi-Fi | `49.37.208.0/20` | testing the app end to end |

`store_1` has no range registered. That is the one
outstanding value and the store refuses every shopper until it is supplied.

`store_2` exists so the journey can be exercised without standing in the shop. Its range is
a **/20, not a /32**, and that is a deliberate widening: the test machine's address moved
from `49.37.208.93` to `49.37.212.85` between two runs an hour apart, because it is a
dynamic residential connection. A `/32` on a dynamic address stops working without anyone
touching the app, and the failure reads as "presence is broken" rather than "the ISP
renewed a lease". The /20 covers the pool both addresses came from.

**This is the thing to settle with the retailer before go-live.** If the Kumbakonam shop's
broadband has a dynamic IP, the same rotation will lock out every shopper mid-pilot, at a
moment nobody is watching for it. Ask the ISP for a static IP on that line — it is usually
a small monthly addition to a business connection — or register the pool range they will
commit to in writing. Do not register a /32 against a dynamic line and hope.

The demo store's range is only as trustworthy as the pool it names: roughly 4,000 addresses
on the same ISP could start a session there. That is acceptable for a store holding a copy
of the catalogue and pointing at the merchant's own VPA, and it would not be acceptable for
`store_1`.

> Store ids changed meaning when the pilot narrowed to one shop. `store_2` was Thanjavur
> East Main and is now the test bench; Kumbakonam was `store_4` and is now `store_1`. Any
> note or ticket written before that change and naming a store id is wrong in a way that
> reads as correct. `docs/branch-onboarding.md` carries the current table.

---

## Before sending the handoff

Run each of these and record the result.

```bash
# Health. Reports which database is in use, whether accounts are durable, and what is
# missing. `pilot_ready` is false while any blocking warning stands.
curl https://dev.snapup.astradyneglobal.com/api/health

# The store is configured. The egress CIDR is the one value without which every
# shopper is refused.
curl -H "Authorization: Bearer $SNAPUP_ADMIN_API_TOKEN" \
     https://dev.snapup.astradyneglobal.com/api/admin/stores
```

`pilot_ready` reports on **platform configuration only** — database, rate limiter, OTP and
reset delivery, presence bypass. It never inspects the store registry, so it does not go
true when a shop's gateway IP is registered and it does not go false when one is missing.
Read the store list for that. Two separate questions, and conflating them means waiting on
a flag that was never going to move.

---

## Handoff message

Fill in from the dashboards. **Never type a DNS value from memory** — copy it from Vercel
or Railway, because a single wrong character produces a domain that fails verification
hours later with no useful error.

```
Snap Up testing environment update

Frontend — Vercel
Deployment URL:  [vercel URL]
Custom domain:   dev.snapup.astradyneglobal.com
DNS:             [TYPE] | [HOST/NAME] | [VALUE/TARGET]

API — same Vercel project, second domain
Custom domain:   api-dev.snapup.astradyneglobal.com
DNS:             [TYPE] | [HOST/NAME] | [VALUE/TARGET]

Console — Vercel
Deployment URL:  [vercel URL]
Custom domain:   [if one is assigned]

Backend health:  [paste /api/health]
Frontend → API:  [Working / Not working]

Notes:
- No Railway service. The API is part of the Next.js frontend, so it is a second
  domain on the same Vercel project rather than a separate deployment. No Railway
  CNAME or TXT verification record exists to send.
- CORS not configured, and not required: no browser makes a cross-origin request.
- Outstanding: the shop's Wi-Fi gateway IP. Until it is registered the store
  refuses every shopper by design.
```

---

## Secrets

None are in the repository, and `.env.local` is gitignored in both apps. Generate the six
signing secrets fresh for this environment rather than reusing development values:

```bash
node -e "for (const n of ['SNAPUP_QR_SECRET','SNAPUP_SESSION_SECRET','SNAPUP_EXIT_TOKEN_SECRET','SNAPUP_ADMIN_API_TOKEN','SNAPUP_ACCOUNT_SECRET','SNAPUP_OTP_PEPPER','SNAPUP_CREDENTIAL_SECRET']) console.log(n + '=' + require('crypto').randomBytes(32).toString('base64url'))"
```

The names are written out in full rather than built from a common suffix, because two of
the seven do not end in `_SECRET` — `SNAPUP_ADMIN_API_TOKEN` and `SNAPUP_OTP_PEPPER`. A
generator that appends the suffix produces two variables the application never reads, and
the failure is silent until something is signed with a development default.

Paste them into Vercel's environment settings, not into a file. The guide is right that
this is a temporary environment — treat every value in it as disposable, and do not reuse
any of it when a production environment is built.
