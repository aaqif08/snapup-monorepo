import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

/**
 * The exit desk, proxied with the staff member's own session.
 *
 * Deliberately not the shared admin token: `verified_by` records who confirmed a payment,
 * and a proxy that attached a machine credential would make every confirmation anonymous.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { code } = await params;
  const store = request.nextUrl.searchParams.get('store_id') ?? '';
  const query = store ? `?store_id=${encodeURIComponent(store)}` : '';
  return forwardAuth(request, `/api/staff/verify/${encodeURIComponent(code)}${query}`);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { code } = await params;
  const store = request.nextUrl.searchParams.get('store_id') ?? '';
  const query = store ? `?store_id=${encodeURIComponent(store)}` : '';
  return forwardAuth(request, `/api/staff/verify/${encodeURIComponent(code)}${query}`, {
    method: 'POST',
    body: (await readJson(request)) ?? {},
  });
}
