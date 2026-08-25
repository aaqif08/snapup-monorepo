import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Console sign-in. The user table lives in the customer app; this relays the session. */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/console/login', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
