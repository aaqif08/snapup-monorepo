import { NextResponse, type NextRequest } from 'next/server';
import { callSnapupAdminApi, unreachableResponse } from '@/server/snapupApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

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
    const upstream = await callSnapupAdminApi(`/api/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
    return NextResponse.json(upstream.body, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const failure = unreachableResponse(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
