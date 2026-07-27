import { NextResponse, type NextRequest } from 'next/server';
import { extractBearerToken, revokeSession, validateSession } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ends a shopping session explicitly (customer taps "finish", or checkout completes). */
export async function POST(request: NextRequest) {
  const validation = validateSession(request, extractBearerToken(request));

  // An already-invalid token is still "ended" as far as the caller is concerned, so this
  // reports success either way rather than making the client handle a pointless error.
  if (validation.valid) {
    revokeSession(validation.payload.sub);
  }

  return NextResponse.json({ ended: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
}
