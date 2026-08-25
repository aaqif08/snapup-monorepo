import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Requests a password-reset link. Always answers the same, account or not. */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/console/forgot', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
