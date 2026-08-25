import 'server-only';
import type { SmsMessage, SmsResult, SmsSender } from './types';

/**
 * MSG91, over their Flow API.
 *
 * ## Why Flow and not the OTP endpoint
 *
 * MSG91 has a dedicated `/api/v5/otp` endpoint that generates *and* verifies the code
 * itself. It is tempting and it is the wrong tool here: SnapUp already generates the code,
 * hashes it, peppers it, caps the attempts and ties it to a challenge row. Handing that to
 * a vendor would mean the security properties of sign-in live in someone else's product
 * and cannot be tested. `/flow/` sends a message and nothing more, which is the job.
 *
 * ## DLT
 *
 * An SMS to an Indian number must match a template registered in advance under TRAI's DLT
 * rules — the operator rejects anything else, whatever the API says. So the request sends
 * a `template_id` plus variables, not prose. `SNAPUP_MSG91_TEMPLATE_ID` is that template.
 *
 * Register one that reads roughly:
 *
 *     ##OTP## is your SnapUp verification code. Valid for 5 minutes. Do not share it.
 *
 * The variable name in the request must match the one in the registered template exactly.
 * MSG91's convention is the template's `##VAR##` placeholders mapped by name, which is why
 * `variables` is a record rather than a positional array.
 */

const ENDPOINT = 'https://control.msg91.com/api/v5/flow/';

/** Per-attempt budget. A customer is watching a spinner; a slow provider must not hang. */
const TIMEOUT_MS = 8000;

export function createMsg91Sender(config: {
  authKey: string;
  templateId: string;
  senderId?: string;
}): SmsSender {
  return {
    name: 'msg91',

    async send(message: SmsMessage): Promise<SmsResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            authkey: config.authKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            template_id: config.templateId,
            ...(config.senderId ? { sender: config.senderId } : {}),
            // `short_url: 0` — these messages contain no links, and MSG91's shortener
            // rewrites anything that looks like one. A rewritten OTP is not an OTP.
            short_url: 0,
            recipients: [{ mobiles: message.to, ...(message.variables ?? {}) }],
          }),
        });

        const text = await response.text();

        if (!response.ok) {
          return {
            ok: false,
            provider: 'msg91',
            reason: `HTTP ${response.status}: ${text.slice(0, 200)}`,
            // 5xx and 429 are worth another attempt; a 400 means the template or the key
            // is wrong and retrying just sends the same broken request again.
            retryable: response.status >= 500 || response.status === 429,
          };
        }

        // MSG91 answers 200 with `{"type":"error"}` for several real failures — an
        // unregistered template, an invalid key — so the status code alone is not the
        // answer. Treating those as success is how a pilot discovers nobody got a code.
        let parsed: { type?: string; message?: unknown; request_id?: string } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          return { ok: false, provider: 'msg91', reason: `non-JSON body: ${text.slice(0, 120)}`, retryable: false };
        }

        if (parsed.type && parsed.type !== 'success') {
          return {
            ok: false,
            provider: 'msg91',
            reason: typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message ?? parsed),
            retryable: false,
          };
        }

        return { ok: true, provider: 'msg91', id: parsed.request_id ?? null };
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return {
          ok: false,
          provider: 'msg91',
          reason: aborted ? `timed out after ${TIMEOUT_MS}ms` : (error as Error).message,
          retryable: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
