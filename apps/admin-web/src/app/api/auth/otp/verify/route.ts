import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Redeem the code for a console session.
 *
 * Points at `/api/auth/console/otp`, not the customer verify endpoint. That one signs up
 * and signs in with the same request, so aiming the console at it would let any mobile
 * number create an account and then be refused at the door, leaving a junk record behind.
 */
export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/auth/console/otp', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
