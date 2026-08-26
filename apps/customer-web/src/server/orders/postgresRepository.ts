import 'server-only';
import { randomNonce } from '../crypto';
import { db, toEpochMs, toEpochMsOrNull } from '../db/client';
import { confirmationStrength, statusForConfirmation } from './paymentPolicy';
import type { OrderLine, OrderRecord, OrderRepository, PaymentConfirmation } from './types';

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

    subtotalPaise: Number(row.subtotal_paise),
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
    const rows = (await sql(
      `${ORDER_SELECT} WHERE o.store_id = $1 AND o.verification_code = $2
         AND o.status IN ('awaiting_payment', 'awaiting_verification')`,
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
