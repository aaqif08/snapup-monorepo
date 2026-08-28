import { NextResponse, type NextRequest } from 'next/server';
import { authorizationUrl, googleConfig, issueState } from '@/server/accounts/google';
import { consumeToken } from '@/server/rateLimit';
import { getEgressIp } from '@/server/network';

/**
 * Begin Google sign-in.
 *
 * A redirect rather than a JSON endpoint, because the browser has to end up on Google's
 * domain — the whole point of the flow is that the password is typed somewhere we cannot
 * see it.
 */
export async function GET(request: NextRequest) {
  const config = googleConfig();
  if (!config) {
    // 404, not 500. A deployment without Google credentials does not offer this route, and
    // saying so as a server error would send someone hunting for a fault that is a
    // configuration choice.
    return NextResponse.json(
      {
        error: {
          code: 'google_not_configured',
          message:
            'Google sign-in is not enabled on this deployment. Set GOOGLE_CLIENT_ID, ' +
            'GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
        },
      },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  // Cheap to hit and it makes an outbound request downstream, so it gets the same
  // treatment as any other unauthenticated entry point.
  const limit = await consumeToken(`google-start:${getEgressIp(request) ?? 'unknown'}`, 10, 1 / 6);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a moment.' } },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } }
    );
  }

  const next = request.nextUrl.searchParams.get('next') ?? '/';
  const url = authorizationUrl(config, issueState(next));

  // `no-store` matters here: the URL carries a one-time state value, and a cached redirect
  // would hand the same one to the next person through.
  return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'no-store' } });
}
