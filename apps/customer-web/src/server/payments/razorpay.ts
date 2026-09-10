import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CreatePaymentInput,
  CreatedPayment,
  PaymentGateway,
  WebhookEvent,
} from './gateway';

/**
 * Razorpay, as the default adapter.
 *
 * Chosen because the pilot collects UPI to an Indian merchant VPA and Razorpay is the
 * most common gateway for exactly that, not because the owner has picked it. Cashfree and
 * PayU differ only in field names and which header carries the signature — if the decision
 * lands elsewhere, this file is the whole of the change.
 *
 * Uses the REST API directly rather than the SDK: three endpoints and an HMAC, against a
 * dependency that would otherwise ship a Node-only client into a Next.js bundle.
 */

const API = 'https://api.razorpay.com/v1';

function credentials() {
  const keyId = process.env.SNAPUP_RAZORPAY_KEY_ID;
  const keySecret = process.env.SNAPUP_RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.SNAPUP_RAZORPAY_WEBHOOK_SECRET;

  // Refused at the point of use, not at import. A missing secret must stop a payment being
  // taken; it must not stop the app booting and serving every other screen.
  if (!keyId || !keySecret) {
    throw new Error(
      'SNAPUP_PAYMENT_GATEWAY=razorpay needs SNAPUP_RAZORPAY_KEY_ID and ' +
        'SNAPUP_RAZORPAY_KEY_SECRET. Refusing to take a payment without them.'
    );
  }
  if (!webhookSecret) {
    throw new Error(
      'SNAPUP_RAZORPAY_WEBHOOK_SECRET is not set. Without it no webhook can be verified, ' +
        'and an unverified webhook is a stranger claiming a basket was paid for.'
    );
  }
  return { keyId, keySecret, webhookSecret };
}

export function razorpayGateway(): PaymentGateway {
  return {
    name: 'razorpay',

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      const { keyId, keySecret } = credentials();

      const response = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          // Razorpay dedupes on this, so a retried create returns the first order rather
          // than opening a second one against the same basket.
          'x-razorpay-idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: 'INR',
          // Echoed back on every webhook, and how an event finds its basket. Razorpay caps
          // receipt at 40 characters; our ids are well inside that.
          receipt: input.orderId,
          notes: { snapup_order_id: input.orderId, store: input.storeName },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Razorpay refused the order (${response.status}): ${detail.slice(0, 300)}`);
      }

      const body = (await response.json()) as { id: string; amount: number };
      return {
        gatewayOrderId: body.id,
        // The key id is publishable by design — it identifies the merchant to the checkout
        // widget. The secret never leaves this module.
        clientPayload: { key: keyId, order_id: body.id, amount: body.amount, currency: 'INR' },
      };
    },

    verifyWebhook(rawBody: string, headers: Headers): WebhookEvent | null {
      const { webhookSecret } = credentials();

      const signature = headers.get('x-razorpay-signature');
      if (!signature) return null;

      // Over the raw body, before any parsing. Re-serialising JSON reorders keys and
      // changes whitespace, and the signature is over bytes.
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      const given = Buffer.from(signature, 'utf8');
      const mine = Buffer.from(expected, 'utf8');
      // Length check first: timingSafeEqual throws on a mismatch, and that throw would
      // itself leak the length through timing.
      if (given.length !== mine.length || !timingSafeEqual(given, mine)) return null;

      let event: {
        event?: string;
        payload?: { payment?: { entity?: Record<string, unknown> } };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return null;
      }

      const payment = event.payload?.payment?.entity;
      if (!payment) return null;

      const notes = (payment.notes ?? {}) as Record<string, unknown>;
      const orderId =
        (typeof notes.snapup_order_id === 'string' && notes.snapup_order_id) ||
        (typeof payment.receipt === 'string' && payment.receipt) ||
        null;
      if (!orderId || typeof payment.id !== 'string') return null;

      const outcome =
        event.event === 'payment.captured'
          ? 'captured'
          : event.event === 'refund.processed'
            ? 'refunded'
            : 'failed';

      return {
        orderId,
        gatewayPaymentId: payment.id,
        amountPaise: Number(payment.amount ?? 0),
        outcome,
        failureReason:
          outcome === 'failed' && typeof payment.error_description === 'string'
            ? payment.error_description
            : undefined,
      };
    },
  };
}
