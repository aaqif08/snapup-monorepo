import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Console sign-up.
 *
 * The upstream decides what the account becomes: the first one ever created is an active
 * owner, every one after it is an inactive staff member awaiting approval. That rule lives
 * there rather than here so it cannot be bypassed by calling the API directly.
 */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/console/signup', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
