import { NextResponse, type NextRequest } from 'next/server';
import { issueEntryQr } from '@/server/qr';
import { getStore } from '@/server/stores';
import { QR_TTL_SECONDS } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issues the dynamic entrance QR for a store display to render.
 *
 * Intentionally unauthenticated: the QR is a public poster on the wall, and knowing it
 * grants nothing on its own — presence factor 2 still has to pass from inside the store.
 * What keeps it safe is the short TTL, so a code photographed today is dead within
 * minutes rather than reusable indefinitely.
 *
 * In the pilot this would be locked to the store's own display device, but that is a
 * device-provisioning concern rather than a customer-facing one.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const store = getStore(id);
  if (!store) {
    return NextResponse.json(
      { error: { code: 'unknown_store', message: 'Store not found.' } },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  const { token, expiresAt } = issueEntryQr(store.id);

  return NextResponse.json(
    {
      qr_token: token,
      store: { id: store.id, name: store.name, ssid: store.advertisedSsid },
      expires_at: expiresAt,
      rotate_after_seconds: QR_TTL_SECONDS,
    },
    // no-store matters here: a cached entrance code would defeat the rotation that makes
    // the short TTL meaningful.
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
