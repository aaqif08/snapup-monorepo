import 'server-only';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { OTP_DELIVERY, OTP_SHARED_PEPPER } from '../env';
import type { OtpChallenge, OtpRepository } from './types';
import { maskPhone } from './phone';
import { sendSms, smsIsLive } from '../sms';

/**
 * One-time codes for customer sign-in.
 *
 * ## The properties that matter
 *
 * **The code is hashed at rest.** A challenge row is a live credential until it expires;
 * anyone who can read the table could otherwise sign in as any customer who happened to
 * be mid-login. Hashing costs nothing here — the code is six digits with a five-minute
 * life, so the usual "hashes must be slow" argument does not apply, but a plaintext one
 * is indefensible.
 *
 * A plain SHA-256 of six digits is trivially reversible by brute force (a million
 * candidates), so it is peppered with a server-side secret. That is what makes a stolen
 * database row useless without also stealing the application's environment.
 *
 * **Attempts are capped.** Six digits is 10^6, which sounds fine until you notice that
 * unlimited guesses against a five-minute window is entirely feasible. Five wrong guesses
 * burn the challenge.
 *
 * **Requesting a code does not reveal whether the account exists.** The endpoint answers
 * identically for a known and an unknown number. Otherwise it is an oracle for "does this
 * person shop here", which is exactly the kind of question a phone number should not
 * answer to an anonymous caller.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** Codes are numeric so they can be typed one-handed while holding a shopping basket. */
function generateCode(): string {
  // `randomInt` is CSPRNG-backed. `Math.random()` here would make codes predictable from
  // one observed code, which is the whole ball game.
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function hashCode(phone: string, code: string): string {
  // The phone is bound into the hash so a code issued for one number cannot be replayed
  // against another, even if two challenges happen to generate the same digits.
  return createHash('sha256').update(`${OTP_SHARED_PEPPER}:${phone}:${code}`).digest('base64url');
}

function codesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssuedOtp {
  challenge: OtpChallenge;
  /**
   * The plaintext code, returned **only** so the caller can deliver it.
   *
   * Never persisted and never included in an HTTP response outside dev delivery mode.
   */
  code: string;
  /** How the code reached the customer, for the response's `delivery` field. */
  delivery: 'sms' | 'log';
}

/**
 * Issue a code and deliver it.
 *
 * Any outstanding challenge for the number is invalidated first, so a customer who taps
 * "resend" is never left guessing which of two codes is live — the newest always wins.
 */
export async function issueOtp(repository: OtpRepository, phone: string): Promise<IssuedOtp> {
  await repository.invalidateFor(phone);

  const code = generateCode();
  const now = Date.now();

  const challenge = await repository.create({
    phone,
    codeHash: hashCode(phone, code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    consumedAt: null,
    createdAt: now,
  });

  const delivery = await deliver(phone, code);
  return { challenge, code, delivery };
}

/**
 * Delivery.
 *
 * `SNAPUP_OTP_DELIVERY` picks the intent and `server/sms` picks the provider, so the two
 * questions stay separate: "should this be a real message" is a deployment decision, and
 * "which vendor" is a configuration one.
 *
 * The failure that matters here is a provider that accepts the request and delivers
 * nothing. MSG91 in particular answers HTTP 200 with an error body for an unregistered
 * DLT template, so `sendSms` inspects the body rather than the status, and a failure
 * throws — the caller turns that into "we could not send a code", which is true, instead
 * of showing a code-entry box for a code that will never arrive.
 */
async function deliver(phone: string, code: string): Promise<'sms' | 'log'> {
  const body = `${code} is your SnapUp verification code. Valid for ${OTP_TTL_MS / 60000} minutes. Do not share it.`;

  if (OTP_DELIVERY === 'log') {
    console.info(`[otp] code for ${maskPhone(phone)} is ${code} (valid ${OTP_TTL_MS / 60000} min)`);
    return 'log';
  }

  if (!smsIsLive()) {
    // Asked for real SMS and no provider is configured. Loud, and fatal to the request:
    // the alternative is a customer staring at a code box forever.
    throw new Error(
      'SNAPUP_OTP_DELIVERY=sms but no SMS provider is configured. Set ' +
        'SNAPUP_MSG91_AUTH_KEY and SNAPUP_MSG91_TEMPLATE_ID.'
    );
  }

  const result = await sendSms({
    to: phone,
    body,
    // The variable name has to match the `##OTP##` placeholder in the registered DLT
    // template. Change one and the other stops working.
    variables: { OTP: code },
  });

  if (!result.ok) {
    throw new Error(`${result.provider} refused to send: ${result.reason}`);
  }

  return 'sms';
}

export type OtpVerdict =
  | { ok: true; challenge: OtpChallenge }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'wrong_code' };

/**
 * Check a submitted code.
 *
 * Every failure mode is distinguished internally so the server log can say what actually
 * happened. The *route* collapses them for the caller — see `auth/otp/verify` — because a
 * response that distinguishes "no challenge" from "wrong code" tells an attacker whether a
 * number is mid-login.
 */
export async function verifyOtp(
  repository: OtpRepository,
  phone: string,
  code: string
): Promise<OtpVerdict> {
  const now = Date.now();
  const challenge = await repository.findActive(phone, now);

  if (!challenge) return { ok: false, reason: 'no_challenge' };
  if (challenge.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  if (!codesMatch(challenge.codeHash, hashCode(phone, code))) {
    // Recorded before returning, so a wrong guess counts even if the client disconnects
    // immediately afterwards.
    await repository.recordAttempt(challenge.id);
    return { ok: false, reason: 'wrong_code' };
  }

  await repository.consume(challenge.id, now);
  return { ok: true, challenge };
}
