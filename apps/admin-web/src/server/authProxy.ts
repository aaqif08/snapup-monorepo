import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { SNAPUP_API_BASE } from './snapupApi';

/**
 * Forwards account-session calls to the customer app, which owns the user table.
 *
 * ## Why a proxy rather than a shared cookie
 *
 * The console runs on a different origin from the API (`:3001` vs `:3000` in
 * development, and usually different hosts in a deployment). A cookie set by one is not
 * sent to the other, so the browser cannot talk to the registry's auth endpoints
 * directly — and making it able to would mean either a wildcard cookie domain or CORS with
 * credentials, both of which widen the blast radius of an XSS bug on either app.
 *
 * Instead the browser holds `snapup_account` for the **console's** origin, this module
 * relays it upstream on each call, and relays any `Set-Cookie` back. The token is opaque
 * to the console — only the customer app holds the secret that signs it — so nothing here
 * can mint or escalate a session.
 *
 * Note what is *not* attached: `SNAPUP_ADMIN_API_TOKEN`. That is a shared machine
 * credential with full registry write access. Attaching it to a user-initiated auth call
 * would mean every console visitor inherited it, which is exactly the confusion between
 * "the app may do this" and "this person may do this" that staff management exists to end.
 */

const ACCOUNT_COOKIE = 'snapup_account';

export async function forwardAuth(
  request: NextRequest,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' }
): Promise<NextResponse> {
  const cookie = request.cookies.get(ACCOUNT_COOKIE);

  let upstream: Response;
  try {
    upstream = await fetch(`${SNAPUP_API_BASE}${path}`, {
      method: init.method,
      headers: {
        ...(cookie ? { cookie: `${ACCOUNT_COOKIE}=${cookie.value}` } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      // Upstream `Set-Cookie` is read off the response and re-issued below, so the fetch
      // itself must not try to manage a cookie jar of its own.
      redirect: 'manual',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'registry_unreachable',
          message: `Could not reach SnapUp at ${SNAPUP_API_BASE}. Is the customer app running? (${
            error instanceof Error ? error.message : 'unknown error'
          })`,
        },
      },
      { status: 502, headers: { 'cache-control': 'no-store' } }
    );
  }

  let body: unknown = null;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  const response = NextResponse.json(body ?? {}, {
    status: upstream.status,
    headers: { 'cache-control': 'no-store' },
  });

  relayCookies(upstream, response, request);
  return response;
}

/**
 * Re-issue upstream's account cookie on this origin.
 *
 * The upstream value is trusted but its *attributes* are not reused verbatim: `Secure` in
 * particular has to reflect how the browser reached the **console**, not how the console
 * reached the API. Copying `Secure` from an https upstream onto a plain-http dev console
 * would produce a cookie the browser silently drops, which presents as "login succeeds and
 * then I am immediately signed out".
 */
function relayCookies(upstream: Response, response: NextResponse, request: NextRequest): void {
  const headers =
    typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : ([upstream.headers.get('set-cookie')].filter(Boolean) as string[]);

  for (const header of headers) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator < 0) continue;

    const name = pair.slice(0, separator).trim();
    if (name !== ACCOUNT_COOKIE) continue;

    const value = pair.slice(separator + 1).trim();
    const clearing = value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(header);

    response.cookies.set(ACCOUNT_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure(request),
      path: '/',
      ...(clearing
        ? { expires: new Date(0), maxAge: 0 }
        : { expires: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) }),
    });
  }
}

function isSecure(request: NextRequest): boolean {
  if (request.headers.get('x-forwarded-proto') === 'https') return true;
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parses a JSON body, returning null rather than throwing on malformed input. */
export async function readJson(request: NextRequest): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
