import { NextResponse, type NextRequest } from 'next/server';

/**
 * Send the browser off to Google, by way of the gateway.
 *
 * A plain redirect to the customer app's start route rather than a rebuilt authorization
 * URL. The gateway signs the `state` value that protects this flow, and duplicating that
 * here would mean sharing the signing key with the console for no gain — the console has
 * nothing to add to the URL that the gateway does not already know.
 */
export async function GET(request: NextRequest) {
  const base = process.env.SNAPUP_API_BASE ?? 'http://localhost:3000';
  const next = request.nextUrl.searchParams.get('next') ?? '/';

  const url = new URL('/api/auth/google/start', base);
  // Only ever a path on the console. Passing an absolute URL through would make the
  // eventual redirect an open one, which is a phishing primitive given away for free.
  url.searchParams.set('next', next.startsWith('/') && !next.startsWith('//') ? next : '/');

  return NextResponse.redirect(url.toString(), {
    status: 302,
    headers: { 'cache-control': 'no-store' },
  });
}
