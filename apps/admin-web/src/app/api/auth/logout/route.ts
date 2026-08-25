import { type NextRequest } from 'next/server';
import { forwardAuth } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST, not GET: a GET logout can be fired by any image tag on any page. */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/logout', { method: 'POST' });
}
