import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { CreatePaymentInput, CreatedPayment, PaymentGateway, WebhookEvent } from './gateway';

/**
 * Cashfree Payments, PG API 2023-08-01.
 *
 * ## Configuration
 *
 *   SNAPUP_PAYMENT_GATEWAY=cashfree
 *   SNAPUP_CASHFREE_APP_ID=...          x-client-id
 *   SNAPUP_CASHFREE_SECRET_KEY=...      x-client-secret; also the key every webhook is signed with
 *   SNAPUP_CASHFREE_ENV=sandbox|production   default sandbox
 *
 * Cashfree signs webhooks with the same secret key the API uses, so there is no separate
 * webhook secret to keep. The webhook URL is set in their dashboard, under Developers →
 * Webhooks, and must point at `/api/payments/webhook` on the deployed host.
 *
 * ## Shape
 *
 * An order is created server-side and returns a `payment_session_id`; the checkout widget
 * on the phone opens against that session. Cashfree keys the order by *our* order id, so a
 * webhook carries it back without any note or receipt field, and a second create for the
 * same basket is refused as a duplicate — which is the idempotency section 2 asks for,
 * enforced by the gateway rather than remembered by us.
 *
 * ## The customer record
 *
 * Cashfree requires a phone number on every order. A signed-in customer has one; a guest
 * does not, and the pilot serves guests. The placeholder below is a syntactically valid
 * Indian mobile number that Cashfree accepts and never dials — it is used for nothing but
 * satisfying the schema. A real number is always preferred when we hold one.
 */

const GUEST_PHONE = '9999999999';

function credentials() {
  const appId = process.env.SNAPUP_CASHFREE_APP_ID;
  const secretKey = process.env.SNAPUP_CASHFREE_SECRET_KEY;
  const env = (process.env.SNAPUP_CASHFREE_ENV ?? 'sandbox').trim().toLowerCase();

  // Refused at the point of use, not at import. A missing secret must stop a payment being
  // taken; it must not stop the app booting and serving every other screen.
  if (!appId || !secretKey) {
    throw new Error(
      'SNAPUP_PAYMENT_GATEWAY=cashfree needs SNAPUP_CASHFREE_APP_ID and ' +
        'SNAPUP_CASHFREE_SECRET_KEY. Refusing to take a payment without them.'
    );
  }
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error(`SNAPUP_CASHFREE_ENV must be "sandbox" or "production", not "${env}".`);
  }

  return {
    appId,
    secretKey,
    mode: env as 'sandbox' | 'production',
    api: env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
  };
}

function headers(extra: Record<string, string> = {}) {
  const { appId, secretKey } = credentials();
  return {
    'content-type': 'application/json',
    'x-client-id': appId,
    'x-client-secret': secretKey,
    'x-api-version': '2023-08-01',
    ...extra,
  };
}

/** Cashfree quotes money in rupees with decimals; we hold paise. Converted at the edge, once. */
function rupees(paise: number): number {
  return Math.round(paise) / 100;
}

function paise(rupeeAmount: unknown): number {
  return Math.round(Number(rupeeAmount ?? 0) * 100);
}

/** How far a webhook's timestamp may sit from our clock before it is treated as a replay. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

interface CashfreeOrder {
  cf_order_id: number | string;
  order_id: string;
  payment_session_id: string;
  order_status: string;
}

async function fetchOrder(orderId: string): Promise<CashfreeOrder> {
  const { api } = credentials();
  const response = await fetch(`${api}/orders/${encodeURIComponent(orderId)}`, { headers: headers() });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cashfree could not return order ${orderId} (${response.status}): ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as CashfreeOrder;
}

export function cashfreeGateway(): PaymentGateway {
  return {
    name: 'cashfree',

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      const { api, mode } = credentials();

      const response = await fetch(`${api}/orders`, {
        method: 'POST',
        // Cashfree dedupes on this for 24 hours, so a retried create returns the first
        // order rather than opening a second one against the same basket.
        headers: headers({ 'x-idempotency-key': input.idempotencyKey }),
        body: JSON.stringify({
          // Our id is the gateway's id. Every webhook carries it back as `order_id`.
          order_id: input.orderId,
          order_amount: rupees(input.amountPaise),
          order_currency: 'INR',
          customer_details: {
            customer_id: input.customer.id,
            customer_phone: input.customer.phone ?? GUEST_PHONE,
            ...(input.customer.name ? { customer_name: input.customer.name } : {}),
          },
          order_note: input.storeName,
        }),
      });

      // The same basket asked twice: Cashfree already holds the order. Fetch it rather than
      // fail — the customer closed the widget and tapped Pay again, and wants back in.
      if (response.status === 409) {
        const existing = await fetchOrder(input.orderId);
        return {
          gatewayOrderId: String(existing.cf_order_id),
          clientPayload: { payment_session_id: existing.payment_session_id, mode },
        };
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Cashfree refused the order (${response.status}): ${detail.slice(0, 300)}`);
      }

      const body = (await response.json()) as CashfreeOrder;
      return {
        gatewayOrderId: String(body.cf_order_id),
        // The session id is what the widget opens against. `mode` tells the widget which
        // environment to load; both are safe on the client — neither is a credential.
        clientPayload: { payment_session_id: body.payment_session_id, mode },
      };
    },

    async clientPayloadFor({ orderId }) {
      // The widget needs the payment session, which only Cashfree holds. Cashfree keys the
      // order by our id, so that is what is looked up; the cf_order_id is kept for records.
      const { mode } = credentials();
      const existing = await fetchOrder(orderId);
      return { payment_session_id: existing.payment_session_id, mode };
    },

    verifyWebhook(rawBody: string, requestHeaders: Headers): WebhookEvent | null {
      const { secretKey } = credentials();

      const signature = requestHeaders.get('x-webhook-signature');
      const timestamp = requestHeaders.get('x-webhook-timestamp');
      if (!signature || !timestamp) return null;

      // A signed statement from a week ago is still a signed statement. The timestamp is
      // inside the signed material, so an attacker cannot freshen a captured one — but a
      // captured one can be replayed as-is, and this is what stops that.
      // Cashfree sends epoch milliseconds; tolerated in seconds too, in case that changes.
      const stamp = Number(timestamp);
      const stampSeconds = stamp > 1e11 ? stamp / 1000 : stamp;
      const age = Math.abs(Date.now() / 1000 - stampSeconds);
      if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) return null;

      // Base64 HMAC-SHA256 over timestamp + raw body, keyed by the secret key. Over the raw
      // bytes: re-serialising JSON reorders keys and changes whitespace.
      const expected = createHmac('sha256', secretKey).update(timestamp + rawBody).digest('base64');
      const given = Buffer.from(signature, 'utf8');
      const mine = Buffer.from(expected, 'utf8');
      if (given.length !== mine.length || !timingSafeEqual(given, mine)) return null;

      let event: {
        type?: string;
        data?: {
          order?: { order_id?: unknown; order_amount?: unknown };
          payment?: {
            cf_payment_id?: unknown;
            payment_status?: unknown;
            payment_amount?: unknown;
            payment_message?: unknown;
          };
          refund?: { cf_refund_id?: unknown; refund_status?: unknown; refund_amount?: unknown; order_id?: unknown };
        };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return null;
      }

      const data = event.data ?? {};

      if (event.type === 'REFUND_STATUS_WEBHOOK') {
        const refund = data.refund ?? {};
        if (refund.refund_status !== 'SUCCESS') return null;
        const orderId = typeof refund.order_id === 'string' ? refund.order_id : null;
        if (!orderId || refund.cf_refund_id === undefined) return null;
        return {
          orderId,
          gatewayPaymentId: String(refund.cf_refund_id),
          amountPaise: paise(refund.refund_amount),
          outcome: 'refunded',
        };
      }

      const orderId = typeof data.order?.order_id === 'string' ? data.order.order_id : null;
      const payment = data.payment ?? {};
      if (!orderId || payment.cf_payment_id === undefined) return null;

      const outcome = event.type === 'PAYMENT_SUCCESS_WEBHOOK' && payment.payment_status === 'SUCCESS'
        ? 'captured'
        : 'failed';

      return {
        orderId,
        gatewayPaymentId: String(payment.cf_payment_id),
        amountPaise: paise(payment.payment_amount ?? data.order?.order_amount),
        outcome,
        failureReason:
          outcome === 'failed' && typeof payment.payment_message === 'string'
            ? payment.payment_message
            : undefined,
      };
    },
  };
}
