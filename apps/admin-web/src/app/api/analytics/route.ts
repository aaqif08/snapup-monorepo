import { NextResponse, type NextRequest } from 'next/server';
import { callSnapupAdminApi, unreachableResponse } from '@/server/snapupApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy to the analytics read model — same reasoning as the stores proxy: the
 * admin credential stays on this server and never reaches the browser bundle.
 */
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id') ?? '';
  const window = request.nextUrl.searchParams.get('window') ?? 'today';

  const query = new URLSearchParams({ store_id: storeId, window });

  try {
    const upstream = await callSnapupAdminApi(`/api/admin/analytics?${query}`, { method: 'GET' });
    return NextResponse.json(upstream.body, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = unreachableResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
