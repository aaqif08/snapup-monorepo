/**
 * Opens a gateway's hosted checkout on the customer's phone.
 *
 * Razorpay and Cashfree are wired, each a `case` here and an adapter server-side. The
 * widget's script is loaded on first use rather than on every page — the pilot runs on UPI
 * deep links until a gateway is configured, and a script for a gateway nobody has chosen
 * has no business on the scanner.
 *
 * What the widget says on success is **not** treated as payment. The promise resolves
 * `'closed'` either way, and the caller then waits for the server to have heard from the
 * gateway itself.
 */

type Outcome = 'closed' | 'dismissed';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => {
      checkout(options: { paymentSessionId: string; redirectTarget: '_modal' }): Promise<{
        error?: unknown;
        redirect?: boolean;
        paymentDetails?: unknown;
      }>;
    };
  }
}

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
const CASHFREE_SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export async function openGatewayCheckout(input: {
  gateway: string;
  client: Record<string, unknown>;
  storeName: string;
  description: string;
}): Promise<Outcome> {
  switch (input.gateway) {
    case 'razorpay': {
      await loadScript(RAZORPAY_SCRIPT);
      if (!window.Razorpay) throw new Error('Razorpay checkout did not initialise.');

      return new Promise<Outcome>((resolve) => {
        const widget = new window.Razorpay!({
          ...input.client,
          name: input.storeName,
          description: input.description,
          // The widget's own success callback. Deliberately not trusted with anything
          // beyond closing: the server learns the result from the gateway's signed
          // webhook, and the caller polls for that.
          handler: () => resolve('closed'),
          modal: { ondismiss: () => resolve('dismissed') },
          theme: { color: '#1B7F5A' },
        });
        widget.open();
      });
    }
    case 'cashfree': {
      await loadScript(CASHFREE_SCRIPT);
      if (!window.Cashfree) throw new Error('Cashfree checkout did not initialise.');

      const sessionId = input.client.payment_session_id;
      const mode = input.client.mode === 'production' ? 'production' : 'sandbox';
      if (typeof sessionId !== 'string') throw new Error('Cashfree session missing.');

      // `_modal` keeps the customer on this page and resolves when the modal closes —
      // paid, failed, or dismissed. Which of those it was is not taken from here: the
      // server hears it from Cashfree's signed webhook, and the caller polls for that.
      const cashfree = window.Cashfree({ mode });
      const result = await cashfree.checkout({ paymentSessionId: sessionId, redirectTarget: '_modal' });
      return result.paymentDetails ? 'closed' : 'dismissed';
    }
    default:
      throw new Error(`No checkout widget for gateway "${input.gateway}".`);
  }
}
