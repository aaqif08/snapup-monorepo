import { NextResponse, type NextRequest } from 'next/server';
import { accountsAreDurable } from '@/server/accounts/repository';
import { readAccount, toPublicUser } from '@/server/accounts/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who is signed in, if anyone.
 *
 * Both apps call this on load rather than trusting a client-side flag. The old
 * `useAuthStore` decided authentication in localStorage, which meant "logged in" was a
 * boolean the user could set themselves in devtools — fine for a mock, not for a console
 * that manages staff.
 *
 * `200 { user: null }` rather than `401` for the signed-out case: not being signed in is
 * an ordinary answer to this question, and a 401 would make every unauthenticated page
 * load look like a failure in the network tab.
 */
export async function GET(request: NextRequest) {
  const result = await readAccount(request);

  return NextResponse.json(
    {
      user: result.ok ? toPublicUser(result.user) : null,
      // Surfaced so the console can warn that accounts vanish on restart. It is the
      // difference between "the login is broken" and "there is no database configured",
      // and only one of those is worth debugging.
      accounts_durable: accountsAreDurable,
      ...(result.ok ? {} : { reason: result.reason }),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
