import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which sign-in methods this deployment actually offers.
 *
 * The sign-in page asks before drawing the Google button. A button that appears and then
 * fails is worse than no button: it reads as a broken product rather than as a feature
 * nobody switched on. Only the client id is consulted — the secret stays on the gateway,
 * and its presence is not something the console needs to know.
 */
export async function GET() {
  return NextResponse.json(
    { google: Boolean(process.env.GOOGLE_CLIENT_ID) },
    { headers: { 'cache-control': 'no-store' } }
  );
}
