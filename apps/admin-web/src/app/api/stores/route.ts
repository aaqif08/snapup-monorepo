import { NextResponse, type NextRequest } from 'next/server';
import { callSnapupAdminApi, unreachableResponse } from '@/server/snapupApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy to the SnapUp store registry.
 *
 * Exists so the admin credential never reaches the browser — see `server/snapupApi.ts`.
 * A useful side effect is that there is no cross-origin request and therefore no CORS
 * configuration to get wrong.
 */
export async function GET() {
  try {
    const upstream = await callSnapupAdminApi('/api/admin/stores', { method: 'GET' });
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
    const upstream = await callSnapupAdminApi('/api/admin/stores', { method: 'POST', body });
    return NextResponse.json(upstream.body, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = unreachableResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
