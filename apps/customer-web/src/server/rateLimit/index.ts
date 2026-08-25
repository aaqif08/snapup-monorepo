import 'server-only';
import { consumeToken as consumeInMemory, type RateLimitResult } from './memory';
import { createUpstashLimiter } from './upstash';

export type { RateLimitResult } from './memory';

/**
 * Rate limiting, shared when it can be and per-instance when it cannot.
 *
 * Upstash when configured, process memory otherwise. The distinction matters more than it
 * looks: the in-memory limiter counts per instance, so on a serverless platform the real
 * limit is `capacity × instances` — and instances scale *up* under load, which is exactly
 * when the limit is meant to bite.
 *
 * That is survivable on one box and not on Vercel. `limiterIsShared()` reports which is in
 * use so `/health` can say so rather than leaving it to be discovered.
 */

type Limiter = (key: string, capacity: number, refillPerSecond: number) => Promise<RateLimitResult>;

function resolve(): { limiter: Limiter; shared: boolean } {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

  if (url && token) {
    return { limiter: createUpstashLimiter({ url, token }), shared: true };
  }

  // Half-configured is a mistake, not a preference. Silently falling back would leave a
  // deployment believing it has shared limits when it has none.
  if (url || token) {
    console.error(
      '[ratelimit] Upstash is half-configured — UPSTASH_REDIS_REST_URL and ' +
        'UPSTASH_REDIS_REST_TOKEN are both required. Falling back to per-instance limits.'
    );
  }

  return {
    limiter: async (key, capacity, refillPerSecond) =>
      consumeInMemory(key, capacity, refillPerSecond),
    shared: false,
  };
}

let cached: { limiter: Limiter; shared: boolean } | null = null;

function current() {
  if (!cached) cached = resolve();
  return cached;
}

/**
 * Spend one token from `key`'s bucket.
 *
 * Async because the shared backend is a network call. Every caller already sits in an
 * async route handler, so this costs nothing in practice — and a synchronous signature
 * would have made a shared limiter impossible without rewriting all of them later.
 */
export function consumeToken(
  key: string,
  capacity: number,
  refillPerSecond: number
): Promise<RateLimitResult> {
  return current().limiter(key, capacity, refillPerSecond);
}

/** True when limits hold across instances. Reported by `/health`. */
export function limiterIsShared(): boolean {
  return current().shared;
}
