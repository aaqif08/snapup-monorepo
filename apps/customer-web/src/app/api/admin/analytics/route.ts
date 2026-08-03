import { NextResponse, type NextRequest } from 'next/server';
import { guardAdminRequest } from '@/server/adminAuth';
import { aggregate, analyticsRepository } from '@/server/analytics';
import { PLATFORM_FEE_PAISE } from '@/server/orders';
import { storeRepository } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store analytics, aggregated from the event log.
 *
 * Scoped to one store per request, and the store id is required rather than optional. A
 * cross-store rollup is a different product — useful to SnapUp, meaningless and arguably
 * improper to a retailer, who must never be able to see a competitor's takings through
 * their own console.
 */
const WINDOWS: Record<string, number> = {
  today: 0, // special-cased: midnight to now, not a rolling 24h
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export async function GET(request: NextRequest) {
  const guard = guardAdminRequest(request);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const storeId = params.get('store_id');
  const windowKey = params.get('window') ?? 'today';

  if (!storeId) {
    return fail(400, 'missing_store_id', 'store_id is required.');
  }
  if (!(windowKey in WINDOWS)) {
    return fail(400, 'unknown_window', `window must be one of: ${Object.keys(WINDOWS).join(', ')}.`);
  }

  const store = await storeRepository.findById(storeId);
  if (!store) return fail(404, 'unknown_store', 'No such store.');

  const now = Date.now();
  // "Today" means since midnight, not the last 24 hours. An owner comparing the dashboard
  // against their till at close of business needs the same day boundary the till uses.
  const fromMs = windowKey === 'today' ? startOfToday(now) : now - WINDOWS[windowKey];

  const events = await analyticsRepository.query({ storeId, fromMs, toMs: now + 1 });
  const analytics = aggregate(storeId, events, { fromMs, toMs: now }, PLATFORM_FEE_PAISE);

  const earliestEventAt = await analyticsRepository.earliestEventAt(storeId);

  return NextResponse.json(
    {
      store: { id: store.id, name: store.name },
      window: windowKey,
      analytics,
      /**
       * How far back the log actually goes. Without it, an empty 30-day chart is
       * indistinguishable between "the shop sold nothing" and "we only started recording
       * this morning" — and an owner who mistakes the second for the first loses trust in
       * every other number on the page.
       */
      data_since: earliestEventAt,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}

function startOfToday(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
