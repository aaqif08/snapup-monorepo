import 'server-only';
import { timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_API_TOKEN } from './env';
import { extractBearerToken } from './session';

/**
 * Gate for the store-registry write API.
 *
 * This is machine-to-machine authentication: the caller is the admin app's server, not a
 * person and not a browser. A human admin authenticates to the admin console itself; the
 * console's server then presents this token on their behalf. Keeping those two layers
 * separate is what stops the shared secret from ever reaching a browser, where it could
 * be read out of the bundle and replayed by anyone.
 *
 * The registry is not ordinary business data — it holds the egress ranges the presence
 * check trusts. Write access to it is effectively the ability to authorise a network, so
 * an attacker who could add their own CIDR to a store could grant themselves sessions
 * from anywhere. That is why writes are gated separately from everything else here.
 */
export type AdminGuardResult = { ok: true } | { ok: false; response: NextResponse };

export function guardAdminRequest(request: NextRequest): AdminGuardResult {
  const presented = extractBearerToken(request);

  if (!presented) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'missing_token', message: 'Admin credentials are required.' } },
        { status: 401, headers: { 'cache-control': 'no-store' } }
      ),
    };
  }

  if (!tokensMatch(presented, ADMIN_API_TOKEN)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'invalid_token', message: 'Admin credentials are not valid.' } },
        { status: 403, headers: { 'cache-control': 'no-store' } }
      ),
    };
  }

  return { ok: true };
}

/**
 * Constant-time comparison, so the token cannot be recovered a byte at a time by timing
 * responses. `timingSafeEqual` throws on a length mismatch, hence the explicit guard —
 * which does leak the token's length, and that is an acceptable trade against the
 * alternative of a comparison whose duration tracks the matching prefix.
 */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
