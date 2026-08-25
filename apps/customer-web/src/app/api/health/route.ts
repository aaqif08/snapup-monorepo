import { NextResponse } from 'next/server';
import { databaseKind } from '@/server/db/client';
import { accountsAreDurable } from '@/server/accounts/repository';
import { limiterIsShared } from '@/server/rateLimit';
import { smsIsLive } from '@/server/sms';
import { OTP_DELIVERY, RESET_DELIVERY, PRESENCE_DEV_BYPASS } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deployment health, and the operational truths that are otherwise invisible.
 *
 * This is not only a liveness probe. Every field below is a configuration state that looks
 * identical to a working system from the outside and behaves very differently under load
 * or in an incident:
 *
 *   - in-memory accounts vanish on restart
 *   - per-instance rate limits scale *up* with traffic, which is backwards
 *   - `log` OTP delivery means no customer receives a code
 *   - the presence bypass means anyone can shop from home
 *
 * Each of those has already been mistaken for a bug at least once while this was being
 * built. Publishing them turns "the login is broken" into "the database is not configured".
 *
 * Unauthenticated on purpose — a load balancer has to reach it — so it reports *whether*
 * things are configured and never what they are configured with. No URLs, no keys, no
 * hostnames.
 */
export async function GET() {
  const database = databaseKind();

  // `warn` rather than `fail`: every one of these still serves traffic. They are wrong for
  // a pilot and fine for a laptop, and a probe that reported unhealthy would take a working
  // demo out of a load balancer.
  const warnings: string[] = [];

  if (database === 'none') {
    warnings.push('No database configured — accounts and orders are lost on restart.');
  }
  if (database === 'embedded') {
    warnings.push(
      'Embedded database (PGlite): one process only. Correct on a single box, wrong on ' +
        'serverless — point DATABASE_URL at hosted Postgres before scaling out.'
    );
  }
  if (!limiterIsShared()) {
    warnings.push(
      'Rate limits are per-instance. On a multi-instance deployment the effective limit ' +
        'is capacity x instances. Configure UPSTASH_REDIS_REST_URL and _TOKEN.'
    );
  }
  if (OTP_DELIVERY === 'log' || !smsIsLive()) {
    warnings.push('OTPs are written to the server log, not sent. No customer can sign in.');
  }
  if (RESET_DELIVERY === 'log') {
    warnings.push('Password reset links are written to the server log, not emailed.');
  }
  if (PRESENCE_DEV_BYPASS) {
    warnings.push(
      'PRESENCE BYPASS IS ON. The store-network check is disabled and anyone can shop ' +
        'from anywhere. This must never be set on a deployed environment.'
    );
  }

  return NextResponse.json(
    {
      status: 'ok',
      database,
      accounts_durable: accountsAreDurable,
      rate_limits_shared: limiterIsShared(),
      sms_live: smsIsLive(),
      otp_delivery: OTP_DELIVERY,
      reset_delivery: RESET_DELIVERY,
      presence_bypass: PRESENCE_DEV_BYPASS,
      warnings,
      pilot_ready: warnings.length === 0,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
