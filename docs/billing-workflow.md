# Billing workflow — gateway payments and shop-database sync

Written against **SnapUp — Intern Implementation & Testing Guide**. Sections 2 and 7 are
built; both are **inert until two values arrive**, and neither can be finished without them.

---

## What is still needed, and why it cannot be guessed

| # | Needed | Why |
| --- | --- | --- |
| 1 | The payment gateway, and its key id / key secret / webhook secret | A webhook signature is verified against a secret. Without it, "the gateway says this was paid" and "a stranger says this was paid" are the same sentence. |
| 2 | The original shop database: connection string, inventory table, its SKU and quantity columns, and the conflict policy | This job writes to somebody else's production database. A guessed column name does not fail cleanly — it either errors after a partial write, or updates a column that exists and means something else. |

Everything else is done. When those arrive, sections 2 and 7 are configuration, not code.

---

## Section 2 — payments

### The rule

> Never trust a payment-success value sent directly by the customer app.

The customer app cannot mark anything paid. It asks for a payment to be created and is told
to wait. The only route that can move an order to `PAYMENT_RECEIVED_PENDING_STAFF` is
`POST /api/payments/webhook`, and it verifies an HMAC over the **raw** request body before
reading a single field out of it.

### Configuration

    SNAPUP_PAYMENT_GATEWAY=razorpay
    SNAPUP_RAZORPAY_KEY_ID=...
    SNAPUP_RAZORPAY_KEY_SECRET=...
    SNAPUP_RAZORPAY_WEBHOOK_SECRET=...

Unset, the app behaves exactly as it does today: a UPI deep link to the merchant VPA, a
customer attestation, and the exit desk as the thing that actually checks. That fallback is
deliberate — it is what the pilot runs on now, and it must not break while a gateway is
being chosen.

**Razorpay is a default, not a decision.** It was chosen because the pilot collects UPI to an
Indian merchant VPA. Cashfree and PayU differ only in field names and which header carries
the signature: `server/payments/gateway.ts` is the interface, `razorpay.ts` is the whole of
the implementation, and a second adapter is one file and one `case`.

### The webhook answers 200 to a bad signature

Gateways retry non-2xx responses, sometimes for days. A 401 would ask an attacker's forged
webhook to be replayed at us on a schedule. The event is dropped and logged instead. A
*verified* event that fails to record does return 500 — there a retry is exactly what we
want.

### Idempotency is in the database

Section 9E asks that a duplicate webhook, a page refresh and a staff double-click each
produce one bill and one deduction. None of that is enforced by checking first: two webhook
deliveries racing on two instances would both pass a check and both write. It is enforced by
unique indexes on `bill_number`, `(gateway, gateway_payment_id)` and `idempotency_key`, and
by `WHERE gateway_payment_id IS NULL` on the write.

### Amounts are re-checked

A gateway reporting a smaller amount than the basket is either a partial capture or a
tampered notification. The order is left alone and the mismatch recorded in
`failure_reason`.

---

## Section 7 — synchronising to the original database

### Configuration

    SNAPUP_ORIGIN_DATABASE_URL=postgresql://...
    SNAPUP_ORIGIN_TABLE_MAP={"inventoryTable":"inventory","inventorySkuColumn":"sku_code","inventoryQtyColumn":"available_qty","inventoryUpdatedColumn":"last_updated","conflictPolicy":"origin_wins"}

Absent, `POST /api/admin/sync/run` returns `not_configured` with **200**, and the outbox
keeps accumulating. Nothing is lost by waiting; the events are still there when the details
arrive.

### Scheduling

A pulled endpoint, not a timer in the process. This deployment can run more than one
instance and an in-process `setInterval` would fire once per instance — three containers
would mean three concurrent syncs every half hour.

    curl -X POST -H "authorization: Bearer $SNAPUP_ADMIN_API_TOKEN" \
         https://<host>/api/admin/sync/run

Overlapping calls are safe regardless: the run claims rows `FOR UPDATE SKIP LOCKED`.

### Deltas, never absolute counts

Every event carries `delta: -2`, not `available_qty: 14`. Writing our count over theirs
would discard every sale their own till made since the last run. This is section 7's "never
overwrite newer original-database data blindly", expressed as arithmetic rather than as a
comparison somebody has to get right.

Under `origin_wins` a deduction additionally refuses to take a row below zero, and a refusal
raises rather than skipping — an unknown SKU or an impossible deduction needs a person, not
a log line.

### Marked synced only after confirmation

`applyToOrigin` returns only once the original has acknowledged the write, and only then is
`synced_at` set. The reverse order is the classic way to lose a sale: the event is marked
done, the write rolls back, nothing looks at it again.

---

## The one place this knowingly departs from the brief

Section 7 asks for the outbox row to be written **in the same transaction** as the change it
describes. It is not: `appendOutbox` runs after the approval statement and swallows its own
failures.

That is deliberate, and it is a compromise. The outbox table does not exist on the pilot
database — the migration is written and unapplied, pending approval — so a hard dependency
would mean every exit approval failing today. A shop that cannot clear a customer is worse
than a log with a gap, because the gap is recoverable by reconciliation and the customer is
standing at the door.

**When the migration is approved, this should be closed**: the outbox insert belongs inside
the same CTE statement as the approval in `postgresRepository.approveExit`, which already
writes the order and the stock atomically. It is a small change, and it removes the window
in which an approved sale is never synced.

---

## Migration

`schema.sql` carries the new columns and tables, all idempotent. It has **not** been applied
to the pilot database — the brief withholds Neon changes until the owner approves them.

Until it is applied, every path above is inert: the gateway is unconfigured, and the outbox
writer detects the missing table and warns once rather than throwing.

    DATABASE_URL='postgresql://…' npm run db:migrate

---

## Acceptance tests

A–D, F and G are exercised today and pass. E's duplicate-webhook case and I's sync run
cannot be tested until the two values above arrive.
