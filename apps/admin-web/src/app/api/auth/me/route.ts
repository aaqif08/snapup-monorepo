import { type NextRequest } from 'next/server';
import { forwardAuth } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who is signed in. Re-read on every load, so a revoked account loses access at once. */
export async function GET(request: NextRequest) {
  return forwardAuth(request, '/api/auth/me');
}
