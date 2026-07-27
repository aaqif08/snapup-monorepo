import 'server-only';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

export function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function randomNonce(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Signs a JSON payload as `<base64url(body)>.<base64url(hmac)>`.
 *
 * This is deliberately not JWT: we control both ends, and JWT's `alg` header is a
 * well-known downgrade footgun (`alg: none`). A fixed HMAC-SHA256 with no negotiable
 * algorithm has no such attack surface.
 */
export function signPayload(payload: object, secret: string): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export type VerifyResult<T> =
  | { valid: true; payload: T }
  | { valid: false; reason: 'malformed' | 'bad_signature' };

export function verifyPayload<T>(token: string, secret: string): VerifyResult<T> {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [body, signature] = parts;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');

  // Compare via timingSafeEqual so a signature cannot be recovered byte-by-byte by
  // timing the response. It throws on length mismatch, hence the explicit guard.
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { valid: false, reason: 'bad_signature' };
  }

  try {
    return { valid: true, payload: JSON.parse(base64UrlDecode(body)) as T };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
