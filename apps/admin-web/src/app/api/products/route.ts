import { NextResponse, type NextRequest } from 'next/server';
import { callSnapupAdminApi, unreachableResponse } from '@/server/snapupApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same-origin proxy to the real product catalogue. See `server/snapupApi.ts`. */
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id') ?? '';

  try {
    const upstream = await callSnapupAdminApi(
      `/api/admin/products?store_id=${encodeURIComponent(storeId)}`,
      { method: 'GET' }
    );
    return NextResponse.json(upstream.body, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = unreachableResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'malformed_request', message: 'Expected a JSON body.' } },
      { status: 400 }
    );
  }

  try {
    const upstream = await callSnapupAdminApi('/api/admin/products', { method: 'POST', body });
    return NextResponse.json(upstream.body, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = unreachableResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
