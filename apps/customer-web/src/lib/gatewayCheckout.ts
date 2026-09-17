/**
 * Opens a gateway's hosted checkout on the customer's phone.
 *
 * Only Razorpay is wired, because only Razorpay has a server adapter; a second gateway is
 * a second `case` here and a second adapter there. The widget's script is loaded on first
 * use rather than on every page — the pilot runs on UPI deep links until a gateway is
 * configured, and a script for a gateway nobody has chosen has no business on the scanner.
 *
 * What the widget says on success is **not** treated as payment. The promise resolves
 * `'closed'` either way, and the caller then waits for the server to have heard from the
 * gateway itself.
 */

type Outcome = 'closed' | 'dismissed';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

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
    default:
      throw new Error(`No checkout widget for gateway "${input.gateway}".`);
  }
}
