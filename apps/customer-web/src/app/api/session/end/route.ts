import { NextResponse, type NextRequest } from 'next/server';
import { extractBearerToken, revokeSession, validateSession } from '@/server/session';
import { recordEvent } from '@/server/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ends a shopping session explicitly (customer taps "finish", or checkout completes). */
export async function POST(request: NextRequest) {
  const validation = await validateSession(request, extractBearerToken(request));

  // An already-invalid token is still "ended" as far as the caller is concerned, so this
  // reports success either way rather than making the client handle a pointless error.
  if (validation.valid) {
    revokeSession(validation.payload.sub);

    // Closes the duration measurement opened by session_started.
    //
    // Only sessions ended *explicitly* produce this event. A customer who simply walks out
    // leaves their token to expire silently after 30 minutes and is never counted, which is
    // why the dashboard reports shopping time over a stated sample size rather than over
    // every session — an abandoned session has no honest duration, and clamping it to the
    // 30-minute cap would invent one.
    recordEvent({
      storeId: validation.payload.sid,
      sessionId: validation.payload.sub,
      kind: 'session_ended',
      occurredAt: Date.now(),
    });
  }

  return NextResponse.json({ ended: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
}
