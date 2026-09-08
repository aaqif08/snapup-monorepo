# Deploying for the pilot

Two Vercel projects and one Neon database. `GET /api/health` on the customer app reports
every item below as a warning until it is done, so the deployment tells you what is
missing rather than you remembering.

## Why `bom1`

Both `vercel.json` files pin the Mumbai region. Every customer, every store and the Neon
database are in India; defaulting to Washington would add ~200 ms to each round trip, and
the barcode-scan budget is ~2 seconds end to end including a call to the retailer's own
API. Latency is the whole product here.

Create the Neon project in a region near Mumbai for the same reason — a database on
another continent undoes the pinning.

## 1. Database — Neon

PGlite is one process per data directory. That is correct on a single box and wrong on
Vercel, where every request may hit a different instance, so the embedded engine cannot be
used in this deployment.

```
DATABASE_URL=postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/snapup?sslmode=require
```

Then, from a machine with that variable set:

```bash
npm run db:migrate
npm run db:import -- data/products.csv data/stores.csv
```

The repositories cannot tell Neon from PGlite — the URL scheme picks the driver — so
nothing else changes.

## 2. Rate limiting — Upstash Redis

Without this, limits are counted per instance. The effective limit becomes
`capacity × instances`, and instances scale up under load — so the harder an endpoint is
hammered, the weaker its limit gets. The endpoints that matter are `otp/request`, which
spends money on an SMS, and `console/login`, which is the front door to the store registry.

```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

REST rather than a Redis client, for the same reason as Neon: a connection pool per
serverless instance exhausts the server long before the traffic is interesting.

## 3. SMS — MSG91

```
SNAPUP_MSG91_AUTH_KEY=...
SNAPUP_MSG91_TEMPLATE_ID=...
SNAPUP_MSG91_SENDER_ID=KMBSNP
SNAPUP_OTP_DELIVERY=sms
```

The template must be **DLT-registered**. TRAI requires it and the operator drops anything
else whatever the API returns — MSG91 in particular answers HTTP 200 with an error body,
which is why the client inspects the body rather than the status.

## 4. Secrets

Generate four distinct values. They are separate so that rotating one has a bounded blast
radius: rotating the account secret signs everyone out of their accounts without dropping
every basket live on a shop floor.

```bash
node -e "for(const n of ['QR','SESSION','EXIT_TOKEN','ACCOUNT','OTP_PEPPER'])
  console.log('SNAPUP_'+n+(n==='OTP_PEPPER'?'':'_SECRET')+'='+require('crypto').randomBytes(32).toString('base64url'))"
```

Plus `SNAPUP_ADMIN_API_TOKEN`, shared by both projects — it is how the console's server
talks to the registry.

## 5. Cross-project wiring

On the **admin** project:

```
SNAPUP_API_BASE=https://<customer-project>.vercel.app
SNAPUP_ADMIN_API_TOKEN=<same value as the customer project>
```

On the **customer** project:

```
SNAPUP_CONSOLE_URL=https://<admin-project>.vercel.app
SNAPUP_CORS_ORIGINS=https://<admin-project>.vercel.app
```

`SNAPUP_CONSOLE_URL` is where password-reset links point. Get it wrong and the link 404s
after the user has already been told to check their email.

## 6. The one that must not be set

```
SNAPUP_PRESENCE_DEV_BYPASS   <- never, on any deployed environment
```

It disables the store-network check, which is the control that stops someone shopping from
their sofa. It is ignored in production builds, and `/api/health` shouts about it anyway.

## 7. Trusted proxy hops

Vercel appends the real client IP to `x-forwarded-for`. The presence check reads the
right-most entry, which assumes exactly one trusted proxy. If you put Cloudflare or another
CDN in front, that becomes two, and `SNAPUP_TRUSTED_PROXY_HOPS` has to match — otherwise
the check reads the CDN's IP and every shopper is refused, or worse, a spoofed header is
believed.

**The value is per-platform, and it is not a guess — measure it.**

| Platform | Hops | What the right-most entry is |
| --- | --- | --- |
| Vercel | `1` | the real client IP |
| Railway | `2` | Railway's internal proxy; the client is one to its left |

Railway was measured, not assumed. With the default of `1` the app bound sessions to
`152.233.15.120` — a Railway proxy address, identical for every shopper on earth — and
refused everyone, because no store's registered range contains it. Setting `2` bound the
session to the real client IP.

Indexing from the right is what makes this safe under a spoofed header rather than merely
correct under an honest one. A client that sends its own `x-forwarded-for` only *prepends*
to the chain, so the entries the platform appended stay at the same distance from the right
and the derived IP is unchanged. That is why the count is measured from the end and never
from the start.

To measure it on a new platform: register `0.0.0.0/0` for a throwaway store, start a
session, and base64url-decode the first segment of the returned token. Its `ip` claim is
exactly what the server derived. Then set the hop count so that claim is the real client
IP, and put the store's real range back. Do this on a test store — never on a live one.

## Verifying

```bash
curl https://<customer-project>.vercel.app/api/health
```

`pilot_ready: true` and an empty `warnings` array means every item above is done.
