import { NextResponse, type NextRequest } from 'next/server';
import { forwardAuth } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google's redirect target.
 *
 * This URL — not the gateway's — is what `GOOGLE_REDIRECT_URI` must be set to, and what the
 * Google Cloud OAuth client must list as an authorised redirect. The reason is the cookie:
 * a session set on the gateway's origin does not reach the console, so the console has to
 * be the origin the browser lands on. It hands the code to the gateway server-to-server and
 * `forwardAuth` relays the resulting `Set-Cookie` here, exactly as password sign-in does.
 *
 * A person is looking at this, so every outcome is a redirect with a reason the sign-in page
 * can turn into a sentence — never a JSON error rendered as raw text in a browser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // They pressed cancel on Google's consent screen. Not a failure worth alarming anyone
  // about — they are simply back where they started.
  if (params.get('error')) return bounce(request, '/login', 'google_cancelled');

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return bounce(request, '/login', 'google_failed');

  const relayed = await forwardAuth(request, '/api/auth/console/google', {
    method: 'POST',
    body: { code, state },
  });

  if (relayed.status >= 400) {
    const body = (await relayed.json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    const reason = body?.error?.code ?? 'google_failed';
    // `google_no_account` goes to signup rather than sign-in: the person has proved who
    // they are and simply has no console account yet, so the useful next screen is the one
    // that makes one.
    return bounce(request, reason === 'google_no_account' ? '/signup' : '/login', reason);
  }

  // The session cookie is on `relayed`, already rewritten for this origin. Carrying it onto
  // the redirect is the whole point of the round trip, so the headers move across verbatim.
  const redirect = bounce(request, '/', null);
  for (const cookie of readSetCookies(relayed)) {
    redirect.headers.append('set-cookie', cookie);
  }
  return redirect;
}

function readSetCookies(response: Response): string[] {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : ([response.headers.get('set-cookie')].filter(Boolean) as string[]);
}

function bounce(request: NextRequest, path: string, reason: string | null): NextResponse {
  const url = new URL(path, request.nextUrl.origin);
  if (reason) url.searchParams.set('auth_error', reason);
  return NextResponse.redirect(url.toString(), {
    status: 302,
    headers: { 'cache-control': 'no-store' },
  });
}
