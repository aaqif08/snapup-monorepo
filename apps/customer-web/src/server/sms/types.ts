import 'server-only';

/**
 * Sending an SMS, behind one interface.
 *
 * The interface exists because the OTP path must not know which provider is configured.
 * Swapping MSG91 for Twilio should be a one-line change in `index.ts` and nothing else —
 * and, more usefully, the `log` sender is what makes the whole sign-in flow testable on a
 * laptop with no SMS account and no money spent.
 */

export interface SmsMessage {
  /** E.164 digits, no `+`. Normalised by `accounts/phone.ts` before it gets here. */
  to: string;
  /** The rendered message body. Providers under DLT may ignore this — see `variables`. */
  body: string;
  /**
   * Template variables, for providers that send a pre-registered template rather than
   * free text.
   *
   * India requires this. Under TRAI's DLT regime an SMS to an Indian number must match a
   * template registered in advance with the operator, and the API sends *variables* to
   * fill it rather than the text itself. `body` is still built, because it is what the
   * `log` sender prints and what a non-DLT provider would send.
   */
  variables?: Record<string, string>;
}

export type SmsResult =
  | { ok: true; provider: string; id: string | null }
  | { ok: false; provider: string; reason: string; retryable: boolean };

export interface SmsSender {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}
