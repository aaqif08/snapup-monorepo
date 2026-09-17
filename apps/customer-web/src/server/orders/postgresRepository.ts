import 'server-only';
import { randomNonce } from '../crypto';
import { db, toEpochMs, toEpochMsOrNull } from '../db/client';
import { confirmationStrength, statusForConfirmation } from './paymentPolicy';
import type { OrderLine, OrderRecord, OrderRepository, PaymentConfirmation } from './types';
// A class, so a value import: it is thrown, not just described.
import { InsufficientStockError } from './types';
import { appendStockOutbox } from '@/server/sync/outbox';

/**
 * The order book, durable.
 *
 * This is the repository the launch-readiness assessment called disqualifying, and the
 * reason is worth keeping next to the code: an order is state that exists nowhere else. A
 * lost product row can be re-entered from the shelf; a lost paid order means a customer was
 * charged and the retailer has no record of it.
 *
 * Two properties this implementation has to preserve, both of which the in-memory version
 * got for free by being single-threaded and are now explicit:
 *
 *   1. An order and its lines are written together or not at all.
 *   2. `markPaid` is idempotent, and a weaker confirmation arriving after a stronger one
 *      never downgrades what is already known.
 */

type OrderRow = Record<string, unknown>;
type LineRow = Record<string, unknown>;

function toLine(row: LineRow): OrderLine {
  return {
    productId: row.product_id as string,
    barcode: row.barcode as string,
    name: row.name as string,
    quantity: Number(row.quantity),
    unitPricePaise: Number(row.unit_price_paise),
    linePaise: Number(row.line_paise),
    unitCostPaise: Number(row.unit_cost_paise),
    lineCostPaise: Number(row.line_cost_paise),
    expectedWeightGrams: Number(row.expected_weight_grams),
  };
}

/**
 * A nullable bigint timestamp, read without inventing a value.
 *
 * `Number(null)` is 0, which as a timestamp is 1 January 1970 — a real instant, and one
 * that would read as "this order was authorised at the exit" for every order that never
 * was. Each column is checked rather than coerced.
 */
function readTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    sessionId: row.session_id as string,
    userId: (row.user_id as string | null) ?? null,
    status: row.status as OrderRecord['status'],
    lines: ((row.lines as LineRow[] | null) ?? []).map(toLine),

    // Nullable throughout: an order is created long before anyone weighs it, and a
    // branch with no scale never will. `Number(null)` is 0, which would read as a
    // basket weighed at nothing, so each is checked rather than coerced.
    observedWeightGrams:
      row.observed_weight_grams === null || row.observed_weight_grams === undefined
        ? null
        : Number(row.observed_weight_grams),
    weightCheckedBy: (row.weight_checked_by as string | null) ?? null,
    weightCheckedAt:
      row.weight_checked_at === null || row.weight_checked_at === undefined
        ? null
        : Number(row.weight_checked_at),
    weightOverrideBy: (row.weight_override_by as string | null) ?? null,
    exitApprovedAt: readTimestamp(row.exit_approved_at),
    exitDeniedAt: readTimestamp(row.exit_denied_at),
    exitDeniedBy: (row.exit_denied_by as string | null) ?? null,
    exitDenialReason: (row.exit_denial_reason as string | null) ?? null,
    inventoryFinalisedAt: readTimestamp(row.inventory_finalised_at),
    billNumber: (row.bill_number as string | null) ?? null,

    subtotalPaise: Number(row.subtotal_paise),
    productSavingsPaise: Number(row.product_savings_paise ?? 0),
    serviceFeePaise: Number(row.service_fee_paise ?? 0),
    gstPaise: Number(row.gst_paise ?? 0),
    discountPaise: Number(row.discount_paise),
    platformFeePaise: Number(row.platform_fee_paise),
    totalPaise: Number(row.total_paise),
    totalCostPaise: Number(row.total_cost_paise),
    expectedWeightGrams: Number(row.expected_weight_grams),

    createdAt: toEpochMs(row.created_at),
    paidAt: toEpochMsOrNull(row.paid_at),

    verificationCode: (row.verification_code as string | null) ?? null,
    verifiedBy: (row.verified_by as string | null) ?? null,
    verifiedAt: toEpochMsOrNull(row.verified_at),

    payment: {
      payeeVpa: (row.payee_vpa as string | null) ?? null,
      payeeName: (row.payee_name as string | null) ?? null,
      transactionRef: row.transaction_ref as string,
      confirmation: row.confirmation as PaymentConfirmation,
    },
  };
}

/**
 * Lines are aggregated in the same statement as the order rather than fetched separately.
 *
 * Two round trips would be the obvious shape, but this query is on the payment path where a
 * partial read is worse than a slow one: an order that returned with an empty `lines` array
 * because the second query had not landed yet would price a basket at zero.
 */
const ORDER_SELECT = `
  SELECT o.*, COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'product_id', l.product_id,
          'barcode', l.barcode,
          'name', l.name,
          'quantity', l.quantity,
          'unit_price_paise', l.unit_price_paise,
          'line_paise', l.line_paise,
          'unit_cost_paise', l.unit_cost_paise,
          'line_cost_paise', l.line_cost_paise,
          'expected_weight_grams', l.expected_weight_grams
        ) ORDER BY l.line_no
      )
      FROM order_lines l WHERE l.order_id = o.id
    ),
    '[]'::json
  ) AS lines
  FROM orders o
`;

class PostgresOrderRepository implements OrderRepository {
  async create(draft: Omit<OrderRecord, 'id'>): Promise<OrderRecord> {
    const sql = db();
    const id = `ord_${randomNonce(9)}`;

    // Written as one transaction over a single HTTP request. Without this an order could be
    // inserted while its lines failed, leaving a row that prices the basket at nothing —
    // and because the exit token is signed over the server's own figures, that corrupt
    // order would produce a *validly signed* pass for a zero-rupee basket.
    const statements = [
      sql`
        INSERT INTO orders (
          id, store_id, session_id, status, subtotal_paise, discount_paise,
          product_savings_paise, service_fee_paise, gst_paise,
          platform_fee_paise, total_paise, total_cost_paise, expected_weight_grams,
          created_at, paid_at, payee_vpa, payee_name, transaction_ref, confirmation,
          verification_code, user_id
        ) VALUES (
          ${id},
          ${draft.storeId},
          ${draft.sessionId},
          ${draft.status},
          ${draft.subtotalPaise},
          ${draft.discountPaise},
          ${draft.productSavingsPaise},
          ${draft.serviceFeePaise},
          ${draft.gstPaise},
          ${draft.platformFeePaise},
          ${draft.totalPaise},
          ${draft.totalCostPaise},
          ${draft.expectedWeightGrams},
          ${draft.createdAt},
          ${draft.paidAt},
          ${draft.payment.payeeVpa},
          ${draft.payment.payeeName},
          ${draft.payment.transactionRef},
          ${draft.payment.confirmation},
          ${draft.verificationCode},
          ${draft.userId}
        )
      `,
      ...draft.lines.map(
        (line, index) => sql`
          INSERT INTO order_lines (
            order_id, line_no, product_id, barcode, name, quantity,
            unit_price_paise, line_paise, unit_cost_paise, line_cost_paise,
            expected_weight_grams
          ) VALUES (
            ${id},
            ${index},
            ${line.productId},
            ${line.barcode},
            ${line.name},
            ${line.quantity},
            ${line.unitPricePaise},
            ${line.linePaise},
            ${line.unitCostPaise},
            ${line.lineCostPaise},
            ${line.expectedWeightGrams}
          )
        `
      ),
    ];

    await sql.transaction(statements);

    // Returned from the caller's own values rather than re-read. The insert either committed
    // exactly this or threw, so a round trip would only confirm what is already known.
    return { ...draft, id, lines: draft.lines.map((line) => ({ ...line })) };
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const sql = db();
    // Called as a plain function rather than as a tagged template, because the shared
    // `ORDER_SELECT` prefix is a string. The `$1` placeholder is still a bound parameter —
    // this is not interpolation.
    const rows = (await sql(`${ORDER_SELECT} WHERE o.id = $1`, [id])) as OrderRow[];
    return rows.length > 0 ? toOrder(rows[0]) : null;
  }

  async findForSession(sessionId: string, orderId: string): Promise<OrderRecord | null> {
    const sql = db();

    // Ownership is part of the WHERE clause, not a check the caller performs afterwards.
    // There is therefore no route that can forget it and expose another customer's basket
    // by guessing an id — and a mismatched session is indistinguishable from a missing
    // order, so the endpoint cannot be used to probe which order ids exist.
    const rows = (await sql(`${ORDER_SELECT} WHERE o.id = $1 AND o.session_id = $2`, [
      orderId,
      sessionId,
    ])) as OrderRow[];

    return rows.length > 0 ? toOrder(rows[0]) : null;
  }

  /**
   * Looks up an order by the code a customer is showing at the exit.
   *
   * Scoped to the store, and to orders that are actually waiting: a code that resolved a
   * `paid` order would let staff "verify" the same basket twice, and one that resolved an
   * `abandoned` order would open the gate for a basket nobody is holding.
   */
  async findByVerificationCode(storeId: string, code: string): Promise<OrderRecord | null> {
    const sql = db();
    // Any basket at this branch that is not abandoned and has not been cleared to leave.
    //
    // This used to admit only `awaiting_payment` and `awaiting_verification` — the states
    // a UPI attestation passes through — on the reasoning that a `paid` order had already
    // been dealt with. A gateway payment lands as `paid` *before* anyone at the desk has
    // looked at it, and that is precisely the basket the desk exists to look at. The
    // guard against verifying twice is `exit_approved_at`, not the payment status.
    //
    // A denied basket stays findable: a customer who fixes what was wrong presents the
    // same code again, and the denial is retained alongside a later approval.
    const rows = (await sql(
      `${ORDER_SELECT} WHERE o.store_id = $1 AND o.verification_code = $2
         AND o.status <> 'abandoned'
         AND o.exit_approved_at IS NULL`,
      [storeId, code]
    )) as OrderRow[];
    return rows.length > 0 ? toOrder(rows[0]) : null;
  }

  async findClearedByVerificationCode(storeId: string, code: string): Promise<OrderRecord | null> {
    const sql = db();
    const rows = (await sql(
      `${ORDER_SELECT} WHERE o.store_id = $1 AND o.verification_code = $2
         AND o.exit_approved_at IS NOT NULL
       ORDER BY o.exit_approved_at DESC LIMIT 1`,
      [storeId, code]
    )) as OrderRow[];
    return rows.length > 0 ? toOrder(rows[0]) : null;
  }

  async listForUser(userId: string, limit: number): Promise<OrderRecord[]> {
    const sql = db();
    const rows = (await sql(
      `${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
      [userId, limit]
    )) as OrderRow[];
    return rows.map(toOrder);
  }

  async markVerified(id: string, verifiedBy: string, at: number): Promise<OrderRecord | null> {
    const sql = db();
    // Guarded on the current status inside the UPDATE rather than checked first. Two staff
    // members verifying the same code at the same moment is entirely plausible at a busy
    // exit; the second one updates zero rows and is told so, instead of both succeeding and
    // the revenue event firing twice.
    const rows = (await sql(
      `UPDATE orders
          SET status = 'paid', confirmation = 'staff_verified',
              verified_by = $2, verified_at = $3,
              paid_at = COALESCE(paid_at, $3)
        WHERE id = $1 AND status IN ('awaiting_payment', 'awaiting_verification')
        RETURNING id`,
      [id, verifiedBy, at]
    )) as OrderRow[];

    if (rows.length === 0) return null;
    return this.findById(id);
  }

  /**
   * Authorise the exit, release the bill, and move the stock — once, or not at all.
   *
   * The guard is inside the UPDATE rather than a read-then-write. Two staff scanning the
   * same exit QR at a busy gate is entirely plausible, and a check-then-act would let both
   * pass: the bill would be released twice, harmlessly, and the stock decremented twice,
   * which is not harmless — the shop's count drifts down every time somebody taps a button
   * they think did nothing.
   *
   * ## Why this is one statement
   *
   * It used to be two: mark the order approved, then reduce stock. Between them the
   * connection can drop, the instance can be recycled, or Neon can time out, and the shop
   * is left with a sale it has approved and stock it never took off the shelf — a
   * discrepancy nobody discovers until a stock-take. A single statement is a single
   * transaction on every driver here, including Neon's HTTP one, which has no interactive
   * transactions to reach for.
   *
   * ## Why it refuses rather than clamps
   *
   * The stock update was `GREATEST(stock - qty, 0)`, which cannot fail. A basket holding
   * more than the shelf does would be approved, the count floored at zero, and the shortfall
   * silently absorbed — the one number the shop uses to decide what to reorder, quietly
   * wrong. Now a short line aborts the whole approval: `short` is computed first, and both
   * the claim and the deduction are gated on it being empty, so an order that cannot be
   * fulfilled leaves no approval, no bill and no stock movement behind.
   */
  async approveExit(orderId: string, staffId: string, at: number): Promise<OrderRecord | null> {
    const sql = db();

    const result = (await sql(
      `WITH need AS (
         SELECT l.product_id, SUM(l.quantity)::int AS qty
           FROM order_lines AS l
          WHERE l.order_id = $1
          GROUP BY l.product_id
       ),
       short AS (
         SELECT n.product_id, p.name, p.stock_quantity, n.qty
           FROM need AS n
           JOIN products AS p ON p.id = n.product_id
          WHERE p.stock_quantity < n.qty
       ),
       claim AS (
         UPDATE orders
            SET exit_approved_at = $2,
                inventory_finalised_at = COALESCE(inventory_finalised_at, $2),
                verified_by = COALESCE(verified_by, $3),
                -- Section 2's state machine, advanced by the thing that completes the sale.
                -- Only from PAYMENT_RECEIVED_PENDING_STAFF: an order on the pilot's UPI
                -- path has no gateway state at all, and inventing an APPROVED_COMPLETED
                -- for it would claim a gateway settled money that never went near one.
                payment_state = CASE
                  WHEN payment_state = 'PAYMENT_RECEIVED_PENDING_STAFF' THEN 'APPROVED_COMPLETED'
                  ELSE payment_state
                END,
                -- Section 5: exactly one bill number, minted here and nowhere else. COALESCE
                -- short-circuits, so the sequence advances only for a row this UPDATE
                -- matches that has no number yet — a refused or replayed approval never
                -- consumes one. IST, because the bill's date is the shop's date.
                bill_number = COALESCE(
                  bill_number,
                  'SU' || to_char(timezone('Asia/Kolkata', now()), 'YYMMDD') || '-'
                       || lpad(nextval('bill_number_seq')::text, 7, '0')
                )
          WHERE id = $1
            AND exit_approved_at IS NULL
            AND exit_denied_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM short)
          RETURNING id, bill_number
       ),
       deduct AS (
         UPDATE products AS p
            SET stock_quantity = p.stock_quantity - n.qty
           FROM need AS n
          WHERE p.id = n.product_id
            AND p.stock_quantity >= n.qty
            AND EXISTS (SELECT 1 FROM claim)
          RETURNING p.id
       ),
       -- Section 6: the bill as it was. Copied from the order lines, which froze name and
       -- price when the basket was priced — the customer paid *that* total, and a price
       -- edited between paying and approval must not restate it. SKU and GST come from the
       -- catalogue row as it stands now, because the order line never carried them; the
       -- product id is kept for analysis but a delisted item cannot orphan its bill line.
       -- Runs only if the claim matched, so a refused approval writes no bill.
       bill AS (
         INSERT INTO bill_items (
           order_id, line_no, product_id, internal_sku, barcode, label,
           quantity, unit_price_paise, line_total_paise, gst_amount_paise, gst_rate_bp
         )
         SELECT l.order_id, l.line_no, l.product_id, COALESCE(p.internal_sku, ''), l.barcode, l.name,
                l.quantity, l.unit_price_paise, l.line_paise,
                COALESCE(p.gst_amount_paise, 0) * l.quantity, p.gst_rate_bp
           FROM order_lines AS l
           LEFT JOIN products AS p ON p.id = l.product_id
          WHERE l.order_id = $1
            AND EXISTS (SELECT 1 FROM claim)
         ON CONFLICT (order_id, line_no) DO NOTHING
         RETURNING order_id
       )
       SELECT (SELECT count(*) FROM claim)::int  AS claimed,
              (SELECT count(*) FROM deduct)::int AS deducted,
              (SELECT count(*) FROM bill)::int   AS billed,
              (SELECT bill_number FROM claim)    AS bill_number,
              (SELECT count(*) FROM need)::int   AS lines,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'name', s.name, 'wanted', s.qty, 'available', s.stock_quantity))
                   FROM short AS s),
                '[]'::json
              ) AS short_items`,
      [orderId, at, staffId]
    )) as {
      claimed: number;
      deducted: number;
      billed: number;
      bill_number: string | null;
      lines: number;
      short_items: { name: string; wanted: number; available: number }[];
    }[];

    const outcome = result[0];

    // Not enough on the shelf. Nothing above ran, so there is nothing to undo — the caller
    // gets the shortfall to put in front of the staff member.
    if (outcome && outcome.short_items.length > 0) {
      throw new InsufficientStockError(outcome.short_items);
    }

    // Lost the race, already authorised, or previously denied. Either way this call moved
    // no stock, and `findById` reports whatever the winning call left behind.
    if (!outcome || outcome.claimed === 0) return null;

    // Loud rather than silent. The statement above is atomic, so this cannot happen
    // without a schema problem — but a sale that moved stock and produced no bill lines
    // is exactly the state section 5 forbids, and it must not pass unremarked.
    if (outcome.billed !== outcome.lines) {
      console.error(
        `[exit] order ${orderId}: approved with ${outcome.billed} bill line(s) for ${outcome.lines} order line(s)`
      );
    }
    console.info(`[exit] order ${orderId}: bill ${outcome.bill_number} released`);

    const order = await this.findById(orderId);

    // Section 7: the stock this approval just moved, as deltas the original database can
    // apply once. Negative, because a sale takes stock off the shelf. Emitted after the
    // approval rather than inside it — see the note in `appendOutbox` about why that is a
    // knowing compromise, and what the honest version costs.
    if (order) {
      // Both identifiers, because only the retailer knows which one their inventory is
      // keyed by. `internal_sku` is their SKU code as it came from the catalogue; the
      // barcode is what is physically on the packet. The origin mapping picks the column,
      // and this refuses to decide on their behalf.
      const skus = (await sql(
        `SELECT id, internal_sku, barcode FROM products WHERE id = ANY($1)`,
        [order.lines.map((line) => line.productId)]
      )) as { id: string; internal_sku: string; barcode: string }[];
      const skuFor = new Map(skus.map((row) => [row.id, row]));

      // One event per line, not one event carrying every line. `appendStockOutbox`
      // explains why: an event that needs several statements to discharge cannot be
      // discharged atomically on this driver, and a retry after a partial failure would
      // re-apply the lines that already landed.
      await appendStockOutbox({
        eventType: 'sale.approved',
        storeId: order.storeId,
        subjectId: order.id,
        context: {
          bill_number: order.billNumber,
          bill_total_paise: order.totalPaise,
          approved_by: staffId,
        },
        lines: order.lines.map((line) => ({
          sku: skuFor.get(line.productId)?.internal_sku ?? '',
          barcode: line.barcode,
          // Negative: a sale takes stock off the shelf. A delta rather than an absolute
          // count, so the original's own till sales between runs are not overwritten.
          delta: -line.quantity,
        })),
        at,
      });
    }

    return order;
  }

  async denyExit(
    orderId: string,
    staffId: string,
    reason: string,
    at: number
  ): Promise<OrderRecord | null> {
    const sql = db();
    // Guarded on approval rather than on denial: refusing twice is harmless and honest,
    // but a basket already cleared to leave cannot be retrospectively refused.
    const rows = (await sql(
      `UPDATE orders
          SET exit_denied_at = $2, exit_denied_by = $3, exit_denial_reason = $4
        WHERE id = $1 AND exit_approved_at IS NULL
        RETURNING id`,
      [orderId, at, staffId, reason]
    )) as OrderRow[];

    if (rows.length === 0) return null;
    return this.findById(orderId);
  }

  async recordWeightCheck(input: {
    orderId: string;
    observedGrams: number;
    checkedBy: string;
    at: number;
    overrodeBy: string | null;
  }): Promise<void> {
    const sql = db();
    // Unconditional on status. By the time this runs the order has already been
    // verified in the same request, and refusing to write the reading because the row
    // moved on would lose the audit trail precisely when it is most wanted.
    await sql(
      `UPDATE orders
          SET observed_weight_grams = $2,
              weight_checked_by     = $3,
              weight_checked_at     = $4,
              weight_override_by    = $5,
              exit_approved_at      = $4
        WHERE id = $1`,
      [input.orderId, input.observedGrams, input.checkedBy, input.at, input.overrodeBy]
    );
  }

  async markPaid(id: string, confirmation: PaymentConfirmation): Promise<OrderRecord | null> {
    const sql = db();
    const status = statusForConfirmation(confirmation);
    const strength = confirmationStrength(confirmation);

    // Idempotency and the no-downgrade rule both live in the statement rather than in a
    // read-then-write, so two taps landing on two instances at the same moment cannot both
    // transition the order.
    //
    // The strength comparison is the important half. Previously this only guarded against
    // overwriting a `paid` row, which meant a `customer_attested` retry could still stamp
    // itself over a `staff_verified` order that had not yet reached `paid` — and, worse,
    // that *any* confirmation set `status = 'paid'`. A customer's claim now lands in
    // `awaiting_verification` and stays there until somebody checks.
    const updated = (await sql`
      UPDATE orders SET
        status       = ${status},
        paid_at      = CASE WHEN ${status} = 'paid' THEN COALESCE(paid_at, ${Date.now()})
                            ELSE paid_at END,
        confirmation = ${confirmation}
      WHERE id = ${id}
        AND ${strength} > CASE confirmation
              WHEN 'unconfirmed'       THEN 0
              WHEN 'customer_attested' THEN 1
              WHEN 'in_store_tender'   THEN 2
              WHEN 'staff_verified'    THEN 3
              WHEN 'psp_webhook'       THEN 4
              ELSE 0 END
      RETURNING id
    `) as { id: string }[];

    // Zero rows means the incoming confirmation was not stronger than what is already
    // recorded. That is a successful no-op, not a failure — the caller asked for a state
    // the order is already in or past — so the current record is returned rather than null.
    return this.findById(id);
  }
}

export const postgresOrderRepository: OrderRepository = new PostgresOrderRepository();
