import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Validates a reset token without consuming it, so the page can say "expired" up front. */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  return forwardAuth(request, `/api/auth/console/reset?token=${encodeURIComponent(token)}`);
}

/** Sets a new password and burns the token. Deliberately does not sign the user in. */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/console/reset', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
