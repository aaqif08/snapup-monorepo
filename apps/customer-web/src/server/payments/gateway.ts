import 'server-only';

/**
 * The payment gateway boundary.
 *
 * ## Why an interface rather than one gateway's SDK
 *
 * The brief leaves the gateway as an open decision for the project owner, and that decision
 * is not mine to make. What is knowable now is the shape of the thing: create a payment on
 * the gateway's server, and later receive a signed statement that it succeeded. Every Indian
 * UPI gateway does both; they disagree only about field names and which HMAC they sign with.
 *
 * So the pilot gets the whole flow — states, idempotency, webhook verification, the refusal
 * to believe the client — and swapping Razorpay for Cashfree or PayU is one file
 * implementing three methods, rather than unpicking payment logic from route handlers.
 *
 * ## The rule this exists to enforce
 *
 * "Never trust a payment-success value sent directly by the customer app." The customer app
 * cannot call anything here. It asks for a payment to be created and is told to wait; the
 * only thing that can move an order to PAYMENT_RECEIVED_PENDING_STAFF is a webhook whose
 * signature verifies against a secret the app has never seen.
 */

export type PaymentState =
  | 'CART'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_RECEIVED_PENDING_STAFF'
  | 'APPROVED_COMPLETED'
  | 'DECLINED_OR_CANCELLED'
  | 'REFUNDED';

export interface CreatePaymentInput {
  /** Our order id, echoed back by the gateway so a webhook can be matched to a basket. */
  orderId: string;
  amountPaise: number;
  /** Sent to the gateway so a retried create cannot open a second payment. */
  idempotencyKey: string;
  storeName: string;
}

export interface CreatedPayment {
  /** The gateway's own id for this attempt. */
  gatewayOrderId: string;
  /** Everything the client needs to open the payment, gateway-shaped and opaque to us. */
  clientPayload: Record<string, unknown>;
}

/** What a verified webhook told us. Nothing here is taken from the client. */
export interface WebhookEvent {
  /** Our order id, recovered from the gateway's echo of it. */
  orderId: string;
  gatewayPaymentId: string;
  amountPaise: number;
  outcome: 'captured' | 'failed' | 'refunded';
  failureReason?: string;
}

export interface PaymentGateway {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /**
   * Verifies the signature and returns the event, or `null` if the signature does not
   * verify. Returning null rather than throwing keeps "not from the gateway" and "the
   * gateway is broken" as different outcomes at the call site.
   */
  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
}

/** True when a gateway is configured. Everything gateway-shaped is inert until then. */
export function gatewayIsConfigured(): boolean {
  return Boolean(process.env.SNAPUP_PAYMENT_GATEWAY);
}

/**
 * The configured gateway, or null.
 *
 * Null is a supported state, not an error: the pilot runs today on UPI deep links with a
 * customer attestation that the exit desk then checks, and that path must keep working
 * untouched while a gateway is being chosen.
 */
export async function activeGateway(): Promise<PaymentGateway | null> {
  const name = process.env.SNAPUP_PAYMENT_GATEWAY?.trim().toLowerCase();
  if (!name) return null;

  switch (name) {
    case 'razorpay': {
      const { razorpayGateway } = await import('./razorpay');
      return razorpayGateway();
    }
    default:
      // Loud, because the alternative is a shop that silently accepts no payments.
      throw new Error(
        `SNAPUP_PAYMENT_GATEWAY is "${name}", which has no adapter. Implement one in ` +
          `server/payments/ and register it here, or unset the variable to fall back to ` +
          `UPI deep links with staff verification.`
      );
  }
}
