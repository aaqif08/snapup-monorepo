import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { consumeToken } from './rateLimit';
import { extractBearerToken, validateSession, type SessionFailure, type SessionPayload } from './session';

/** Product reads: burst of 40, sustained 4/sec. Comfortable for scanning, hostile to enumeration. */
const PRODUCT_READ_CAPACITY = 40;
const PRODUCT_READ_REFILL_PER_SECOND = 4;

/**
 * Reasons are deliberately coarse in the response body. `presence_lost` and `expired`
 * are safe and actionable for the customer's UI, but we never echo which store CIDR was
 * checked or what IP we observed — that would help someone map the store's network.
 */
const FAILURE_STATUS: Record<SessionFailure, number> = {
  missing_token: 401,
  malformed: 401,
  bad_signature: 401,
  unknown_version: 401,
  expired: 401,
  revoked: 401,
  unknown_store: 403,
  presence_lost: 403,
};

export type GuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, code: string, message: string, extra?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store', ...extra } }
  );
}

/**
 * Gate for every product endpoint: an active, presence-validated session is required
 * before the database is touched at all.
 */
export function guardProductRequest(request: NextRequest): GuardResult {
  const token = extractBearerToken(request);
  const validation = validateSession(request, token);

  if (!validation.valid) {
    return {
      ok: false,
      response: errorResponse(
        FAILURE_STATUS[validation.reason],
        validation.reason,
        sessionFailureMessage(validation.reason)
      ),
    };
  }

  // Keyed by session id, so one customer cannot exhaust another customer's budget.
  const limit = consumeToken(
    `products:${validation.payload.sub}`,
    PRODUCT_READ_CAPACITY,
    PRODUCT_READ_REFILL_PER_SECOND
  );

  if (!limit.allowed) {
    return {
      ok: false,
      response: errorResponse(429, 'rate_limited', 'Too many requests.', {
        'retry-after': String(limit.retryAfterSeconds),
      }),
    };
  }

  return { ok: true, session: validation.payload };
}

function sessionFailureMessage(reason: SessionFailure): string {
  switch (reason) {
    case 'presence_lost':
      return 'Store presence could not be confirmed. Reconnect to the store Wi-Fi and scan the entrance code again.';
    case 'expired':
      return 'Your shopping session has expired. Scan the entrance code again to continue.';
    case 'revoked':
      return 'This shopping session has ended.';
    default:
      return 'A valid shopping session is required.';
  }
}
