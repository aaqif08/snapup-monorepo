import { NextResponse, type NextRequest } from 'next/server';
import { clearAccountCookie, isSecureRequest } from '@/server/accounts/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The only way an account session ends.
 *
 * There is no expiry to fall back on, which makes this the single exit — so it is a POST
 * (a GET would let any `<img src>` on any page sign a customer out) and it always
 * succeeds. Clearing a cookie that was already absent is not an error, and returning one
 * would leave a user stuck on a page they cannot leave.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json(
    { signed_out: true },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
  clearAccountCookie(response, isSecureRequest(request));
  return response;
}
