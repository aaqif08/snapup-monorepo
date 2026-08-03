/**
 * UPI deep-link builder, per the NPCI UPI Linking Specification's `upi://pay`
 * intent format. This is the real, standard mechanism Indian payment apps
 * (GPay, PhonePe, Paytm, BHIM) register as OS-level handlers for — tapping
 * a correctly-formed upi://pay link on a phone triggers the native "open
 * with" picker if multiple UPI apps are installed, or opens the only one
 * directly if just one is present.
 *
 * PAYEE AND AMOUNT BOTH COME FROM THE SERVER. Neither is a constant here and
 * neither is computed in the browser:
 *
 * - `payeeVpa` is the individual shop's UPI address, read from the store
 *   registry. Under the phase-1 payment model the customer pays the retailer
 *   directly and SnapUp settles its service charge separately, so there is no
 *   single platform-wide merchant address — which is what the previous
 *   hardcoded `snapup.demo@upi` placeholder wrongly assumed.
 * - `amountRupees` comes from a server-priced order. It was previously derived
 *   from the client's own cart total, meaning anyone could edit the amount they
 *   were about to pay the shop.
 *
 * A note on the phase-1 model's limit, since this file is where it bites: money
 * moving straight to the retailer means no payment provider ever tells SnapUp
 * the transfer happened. There is no callback to wait for and no way to verify
 * from here. A PSP with split settlement (Razorpay Route, Cashfree Easy Split,
 * PhonePe sub-merchant) keeps the same "money lands in the merchant's account"
 * outcome while adding the server-to-server confirmation this mechanism cannot
 * provide on its own.
 */

export interface UpiPaymentParams {
  /** The shop's UPI address, from the store registry. */
  payeeVpa: string;
  /** Name the customer sees in their UPI app when confirming. */
  payeeName: string;
  /** Server-computed order total, in rupees. */
  amountRupees: number;
  transactionRef: string;
  note?: string;
}

export function buildUpiLink({
  payeeVpa,
  payeeName,
  amountRupees,
  transactionRef,
  note,
}: UpiPaymentParams): string {
  const params = new URLSearchParams({
    pa: payeeVpa, // payee address (the shop's merchant VPA)
    pn: payeeName, // payee name
    am: amountRupees.toFixed(2), // amount
    cu: 'INR', // currency
    tr: transactionRef, // transaction reference, for reconciliation
    tn: note ?? `SnapUp order ${transactionRef}`, // transaction note
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * Some UPI apps (notably GPay) also register their own app-specific intent
 * scheme, in addition to the generic upi://pay every compliant app must
 * support. Google's own developer docs and multiple PSP integration guides
 * (EBANX, PayU) confirm GPay answers to "gpay://upi/pay?" (current) and
 * "tez://upi/pay?" (older alias, GPay's product was previously "Tez") with
 * identical query params to the generic link.
 *
 * Platform behavior differs and is worth knowing before you rely on this:
 * - Android: the generic upi://pay link shows the OS's "open with" picker
 *   listing every installed UPI app: this is what NPCI requires under the
 *   "Pay by any UPI app" option, so that row should always use the GENERIC
 *   link, never an app-specific scheme.
 * - iOS: there's no picker — the OS opens whichever UPI app is registered
 *   as default, and after payment the user must manually switch back to
 *   the browser tab; there's currently no auto-return mechanism.
 */
export function buildAppSpecificUpiLink(
  app: 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'generic',
  params: UpiPaymentParams
): string {
  const genericLink = buildUpiLink(params);
  if (app === 'gpay') {
    const query = genericLink.split('?')[1];
    return `gpay://upi/pay?${query}`;
  }
  // PhonePe, Paytm, BHIM, and "any UPI app" all work through the standard
  // upi://pay link — and per NPCI mandate, "any UPI app" must use this
  // generic form rather than a specific app's package/scheme.
  return genericLink;
}

/**
 * Detects whether we're likely on a mobile device where a upi:// link has
 * any chance of being handled by an installed app. Desktop browsers have
 * no UPI app to catch the intent, so attempting the redirect there just
 * shows a confusing "can't open this link" browser dialog — better to
 * detect that case and show a QR code to scan with a phone instead.
 */
export function isLikelyMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Attempts an app-specific UPI scheme first (e.g. gpay://), then falls
 * back to the generic upi://pay link if the app-specific one doesn't seem
 * to have taken the page away within a short window. There's no reliable
 * JS API to confirm a custom scheme actually launched an app — the browser
 * either navigates away (app opened, page goes to background) or silently
 * does nothing (app not installed). This timer-based fallback is the
 * standard, widely-used pattern for that uncertainty.
 */
export function attemptUpiRedirect(
  app: 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'generic',
  params: UpiPaymentParams,
  onFallbackToQr: () => void
): void {
  const specificLink = buildAppSpecificUpiLink(app, params);
  const genericLink = buildUpiLink(params);

  let didHide = false;
  const handleVisibilityChange = () => {
    if (document.hidden) didHide = true;
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  window.location.href = specificLink;

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (didHide) return; // App-specific scheme worked, page is backgrounded — nothing more to do.

    if (app !== 'generic') {
      // App-specific scheme likely failed (app not installed) — try the
      // generic link, which every compliant UPI app answers to.
      window.location.href = genericLink;
      window.setTimeout(() => {
        if (!document.hidden) onFallbackToQr();
      }, 1500);
    } else {
      onFallbackToQr();
    }
  }, 1500);
}
