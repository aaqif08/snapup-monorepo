import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff listing and creation.
 *
 * Forwarded with the caller's *account* cookie and deliberately not with the shared admin
 * token: the upstream decides what this person may do from their role. A proxy that
 * attached the machine credential would let any console visitor manage staff.
 */
export async function GET(request: NextRequest) {
  return forwardAuth(request, '/api/staff');
}

export async function POST(request: NextRequest) {
  return forwardAuth(request, '/api/staff', {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
