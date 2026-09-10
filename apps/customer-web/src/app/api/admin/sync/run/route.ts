import { NextResponse, type NextRequest } from 'next/server';
import { runSync } from '@/server/sync/run';
import { ADMIN_API_TOKEN } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A backlog can take a while; the default serverless budget is not enough. */
export const maxDuration = 300;

/**
 * The 30-minute synchronisation, triggered.
 *
 * A pulled endpoint rather than a timer inside the app: this deployment scales to more than
 * one instance, and an in-process `setInterval` would run the job once per instance, so
 * three containers would mean three concurrent syncs every half hour. A scheduler calls this
 * once. Railway's cron, or any external pinger, with:
 *
 *   curl -X POST -H "authorization: Bearer $SNAPUP_ADMIN_API_TOKEN" \
 *        https://<host>/api/admin/sync/run
 *
 * Overlapping calls are safe anyway — `runSync` claims rows with SKIP LOCKED — but running
 * it once is cheaper and makes the run log readable.
 */
export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  // The shared machine token, not a staff session: the caller is a scheduler, and there is
  // no person to attribute the run to.
  if (!token || token !== ADMIN_API_TOKEN) {
    return NextResponse.json(
      { error: { code: 'invalid_token', message: 'A valid admin token is required.' } },
      { status: 403, headers: { 'cache-control': 'no-store' } }
    );
  }

  const result = await runSync();

  // `not_configured` is 200 on purpose. It is the expected state until the original
  // database's details arrive, and a scheduler that saw an error status would start paging
  // somebody about a job that is correctly declining to guess.
  return NextResponse.json(result, {
    status: result.outcome === 'failed' ? 500 : 200,
    headers: { 'cache-control': 'no-store' },
  });
}
