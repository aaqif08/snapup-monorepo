# Billing workflow — gateway payments and shop-database sync

Written against **SnapUp — Intern Implementation & Testing Guide**. Sections 2 and 7 are
built; both are **inert until two values arrive**, and neither can be finished without them.

---

## What is still needed, and why it cannot be guessed

| # | Needed | Why |
| --- | --- | --- |
| 1 | The payment gateway, and its key id / key secret / webhook secret | A webhook signature is verified against a secret. Without it, "the gateway says this was paid" and "a stranger says this was paid" are the same sentence. |
| 2 | The original shop database: connection string, inventory table, its SKU and quantity columns, and the conflict policy | This job writes to somebody else's production database. A guessed column name does not fail cleanly — it either errors after a partial write, or updates a column that exists and means something else. |

When those arrive, sections 2 and 7 become configuration rather than code — but they are
not the only things outstanding. See **What is not built** at the end.

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

**Nothing currently calls it on a schedule.** The endpoint is the half that belongs in the
codebase; the half-hourly trigger is a Railway cron (or any external pinger) that still has
to be created, and section 7 is not met until it is.

### Overlapping runs

A run **claims** its events by writing its run id onto the row, in the same statement that
selects them.

This was previously `SELECT ... FOR UPDATE SKIP LOCKED`, which does not work on this driver
and quietly did nothing: there is no session, so each statement is its own transaction and
the lock was released the moment the `SELECT` returned. Two runs would read the same rows
and send the same deltas, and the original would apply each one twice. A written claim
outlives the statement that took it; a lock does not.

A claim expires after ten minutes, so a run that dies mid-flight does not strand its events.

### One SKU per event

A sale of five lines becomes five outbox rows, not one row carrying five lines. An event has
to be dischargeable in a single statement, because a single statement is the only thing that
is atomic here — a five-line event failing on the third would leave two lines applied to
the original, the event unmarked, and the retry would apply those two again.

What remains is a one-statement window: the `UPDATE` lands and the process dies before
`synced_at` is written. Closing it needs a ledger in the *original* database keyed by event
id, which is one of the things section 7 says to ask for rather than guess. Worth asking
for — it is the difference between at-least-once and exactly-once.

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

An event with nothing to send — a payment state change, under an inventory-only mapping —
is recorded as `skipped_at` with a reason rather than `synced_at`. "We wrote this to the
original" and "there was nothing here for the original to know" must not look the same to
whoever reads the table after an incident.

### Reconciliation

Each run compares the SKUs it moved against the original's own counts and records the
disagreements on `sync_runs.reconciliation`.

Scoped to what the run touched, not the whole catalogue: sweeping 547 SKUs against someone
else's production database every half hour is load they have not agreed to, and the rows
that just changed are where a fault would be new.

**Mismatches are reported, never corrected.** Their till selling something we have not seen
is a legitimate difference under `origin_wins`, and a job that "fixed" it would be
overwriting newer original data — exactly what section 7 forbids. Reconciliation failing
does not fail the run: the events were already applied and acknowledged, and losing the
comparison afterwards must not make a good sync look broken.

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

## Section 8 — importing stock

`stock` in a product sheet is a **delivery, added** to what is on the shelf. It used to be
assigned — `stock_quantity = EXCLUDED.stock_quantity` — so re-importing a sheet to correct
one price silently reset every count on it to whatever the sheet said, discarding every sale
since it was exported. The import reported success either way, which is what made it worth
fixing before anything else in this file.

    npm run db:import -- products.csv                     # 40 in the sheet  →  shelf + 40
    npm run db:import -- products.csv --stock-take        # 40 in the sheet  →  shelf = 40
    npm run db:import -- products.csv --actor=priya

`--stock-take` is section 8's "explicitly approved stock-take/import mode": it has to be
typed, it is named in the audit row, and the script prints which mode it is in before it
writes anything.

Every movement writes a `stock_imports` row — actor, mode, before and after counts, source
file — and an outbox event carrying **the delta that actually happened**. Under
`--stock-take` those differ: a sheet declaring 40 against a shelf of 55 is a delta of `-15`,
and that is the number the original database needs to reach the same answer.

---

## Acceptance tests

A–D, F and G are exercised today and pass. H passes. E's duplicate-webhook case and I's
sync run cannot be tested until the two values above arrive — though I's *duplicate*
concern is now testable in isolation and does hold: two overlapping runs claim disjoint
event sets.

There is still **no automated test suite**, which section 9 asks for and section 10 wants a
report from. The checks above were run by hand against the embedded database.

---

## What is not built

Named here so this document stops implying the brief is met.

| Section | Missing |
| --- | --- |
| 5, 6 | **Bill generation.** `bill_items` and `bill_number` exist in `schema.sql`; nothing writes them. Approval sets `exit_approved_at`, moves stock and advances `payment_state`, but never mints a bill number or a bill-items row. "Exactly one bill number and final bill, inserted into bill history" is not implemented. |
| 2 | **Payment initiation.** `razorpay.ts` implements `createPayment` and nothing calls it. No route creates a gateway order, so `gateway_order_id` and `idempotency_key` are never written and a customer cannot start a gateway payment. The webhook half is built and verified. |
| 3, 6 | **`inventory.available_qty` vs `products.stock_quantity`.** The brief names `inventory.available_qty` as the authoritative field for all 547 SKUs. This schema has no `inventory` table and no `last_updated`; stock lives on `products.stock_quantity`. One of the two is wrong and it needs the owner, not a guess. |
| 7 | **The 30-minute trigger.** The endpoint exists; nothing calls it on a schedule. |
| 7 | **Outbox not in the approval transaction.** Unchanged and still deliberate — see above. |
| 9, 10 | **Automated tests and the final report.** |
