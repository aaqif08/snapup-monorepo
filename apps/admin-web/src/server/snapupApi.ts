import 'server-only';

/**
 * Server-side connection to the SnapUp store registry.
 *
 * Everything in this module stays on the admin app's server. The admin API token is a
 * write credential for the store registry — and because a registry entry carries the
 * egress ranges the presence check trusts, holding it is effectively the ability to
 * authorise a network. Shipping it to the browser would put it in the JavaScript bundle,
 * readable and replayable by anyone who opened devtools, which is the same class of
 * mistake Requirement 2 was raised about.
 *
 * The flow is therefore two-layered:
 *   browser -> admin-web's own /api/stores route (session-authenticated admin)
 *           -> customer-web's /api/admin/stores (token-authenticated machine call)
 *
 * Note the deliberate absence of a NEXT_PUBLIC_ prefix on the token: that prefix is what
 * inlines a value into the client bundle, so its absence is load-bearing rather than
 * stylistic.
 */
const DEFAULT_API_BASE = 'http://localhost:3000';

export const SNAPUP_API_BASE = (process.env.SNAPUP_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');

function requireAdminToken(): string {
  const token = process.env.SNAPUP_ADMIN_API_TOKEN;
  if (token && token.length > 0) return token;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SNAPUP_ADMIN_API_TOKEN is not set. Refusing to start with a default admin credential in production.'
    );
  }
  // Matches the dev fallback in customer-web's env.ts so local development works with no
  // configuration at all. Both sides fail closed in production.
  return 'dev-only-admin-token-never-use-in-production';
}

export interface UpstreamResponse {
  status: number;
  body: unknown;
}

/**
 * Forwards a call to the customer-web admin API, attaching the credential.
 *
 * Upstream status codes and bodies are passed through unchanged so the console can show
 * the real validation errors — "Not valid CIDR notation: 10.0.0.1" is actionable, whereas
 * a flattened "save failed" would leave an operator guessing.
 */
export async function callSnapupAdminApi(
  path: string,
  init: { method: string; body?: unknown }
): Promise<UpstreamResponse> {
  const response = await fetch(`${SNAPUP_API_BASE}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${requireAdminToken()}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = { error: { code: 'upstream_unreadable', message: 'Upstream returned no JSON body.' } };
  }

  return { status: response.status, body };
}

/** Shape returned to the console when the registry cannot be reached at all. */
export function unreachableResponse(error: unknown): UpstreamResponse {
  return {
    status: 502,
    body: {
      error: {
        code: 'registry_unreachable',
        message: `Could not reach the SnapUp store registry at ${SNAPUP_API_BASE}. Is the customer app running? (${
          error instanceof Error ? error.message : 'unknown error'
        })`,
      },
    },
  };
}
