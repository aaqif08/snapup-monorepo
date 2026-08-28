import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Send a one-time code. The shared endpoint: only redeeming it differs for the console. */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/otp/request', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
