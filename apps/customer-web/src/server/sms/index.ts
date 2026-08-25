import 'server-only';
import { maskPhone } from '../accounts/phone';
import { createMsg91Sender } from './msg91';
import type { SmsMessage, SmsResult, SmsSender } from './types';

export type { SmsMessage, SmsResult, SmsSender } from './types';

/**
 * Which sender is in use, decided once from the environment.
 *
 * `log` prints to the server console. That is not a stub pretending to send — it is the
 * mode that makes sign-in testable with no SMS account, and it announces itself in every
 * line it writes so nobody mistakes a working log for a working SMS.
 */
function resolve(): SmsSender {
  const authKey = process.env.SNAPUP_MSG91_AUTH_KEY ?? '';
  const templateId = process.env.SNAPUP_MSG91_TEMPLATE_ID ?? '';

  if (authKey && templateId) {
    return createMsg91Sender({
      authKey,
      templateId,
      senderId: process.env.SNAPUP_MSG91_SENDER_ID || undefined,
    });
  }

  // Half-configured is a mistake worth naming rather than silently downgrading. A
  // deployment that set the key and forgot the template would otherwise look fine and
  // send nothing.
  if (authKey || templateId) {
    console.error(
      '[sms] MSG91 is half-configured — both SNAPUP_MSG91_AUTH_KEY and ' +
        'SNAPUP_MSG91_TEMPLATE_ID are required. Falling back to the log sender, which ' +
        'means no customer will receive a code.'
    );
  }

  return logSender;
}

const logSender: SmsSender = {
  name: 'log',
  async send(message: SmsMessage): Promise<SmsResult> {
    console.info(`[sms:log] to ${maskPhone(message.to)} — ${message.body}`);
    return { ok: true, provider: 'log', id: null };
  },
};

let cached: SmsSender | null = null;

export function smsSender(): SmsSender {
  if (!cached) cached = resolve();
  return cached;
}

/** True when messages actually leave the building. Reported by `/health`. */
export function smsIsLive(): boolean {
  return smsSender().name !== 'log';
}

/**
 * Send, with one retry for failures that are worth retrying.
 *
 * Deliberately not more. A customer is waiting on this call, and a provider that is down
 * stays down for longer than anyone will hold a phone — so the second attempt is for a
 * blip, and anything past that should surface as "we could not send a code" rather than as
 * a spinner.
 */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  const sender = smsSender();

  const first = await sender.send(message);
  if (first.ok || !first.retryable) return first;

  console.warn(`[sms] ${sender.name} failed (${first.reason}); retrying once`);
  return sender.send(message);
}
