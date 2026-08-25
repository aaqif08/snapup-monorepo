import 'server-only';
import type { RateLimitResult } from './memory';

/**
 * Shared token buckets in Redis, over Upstash's REST API.
 *
 * ## Why this has to exist for a real deployment
 *
 * The in-memory limiter counts per *instance*. On Vercel that means the effective limit is
 * roughly `capacity × instance count`, and the number of instances is decided by traffic —
 * so the harder someone hammers an endpoint, the more instances spin up and the higher the
 * limit becomes. That is the exact opposite of what a rate limiter is for.
 *
 * The endpoints where it matters are not theoretical: `otp/request` sends an SMS that costs
 * money and lands on somebody's phone, and `console/login` is the front door to the store
 * registry.
 *
 * ## Why REST rather than a Redis client
 *
 * Same reason the database uses Neon's HTTP driver. A TCP connection pool in a serverless
 * function is a pool per instance, and Redis runs out of connections long before the
 * traffic is interesting. REST has no connection to keep alive.
 *
 * ## Why a Lua script
 *
 * A token bucket is read-modify-write. Doing that as three round trips means two instances
 * can both read `1 token`, both decrement, and both allow — which under load is precisely
 * when the limit is supposed to hold. `EVAL` makes it one atomic operation on the server.
 */

/**
 * Refill, spend, and report how long to wait. Returns `{allowed, retryAfterSeconds}`.
 *
 * `PEXPIRE` on every call is what keeps the keyspace bounded: an idle bucket is a bucket
 * that has refilled to capacity anyway, so forgetting it changes nothing and reclaims the
 * memory.
 */
const SCRIPT = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local state  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)

local retry = 0
if allowed == 0 then
  retry = math.ceil((1 - tokens) / refill)
end

return {allowed, retry}
`;

const TIMEOUT_MS = 2000;

export function createUpstashLimiter(config: { url: string; token: string }) {
  const endpoint = config.url.replace(/\/$/, '');

  return async function consume(
    key: string,
    capacity: number,
    refillPerSecond: number
  ): Promise<RateLimitResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // A bucket is worthless once it has refilled to capacity, so the TTL is the time that
    // takes plus a margin.
    const ttlMs = Math.ceil((capacity / refillPerSecond) * 1000) + 60_000;

    try {
      const response = await fetch(`${endpoint}/eval`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          SCRIPT,
          1,
          `rl:${key}`,
          String(capacity),
          String(refillPerSecond),
          String(Date.now()),
          String(ttlMs),
        ]),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = (await response.json()) as { result?: [number, number] };
      const [allowed, retry] = body.result ?? [1, 0];

      return {
        allowed: allowed === 1,
        // Not tracked across the REST boundary; nothing reads it, and returning a
        // fabricated number would be worse than returning zero.
        remaining: 0,
        retryAfterSeconds: retry,
      };
    } catch (error) {
      // **Fails open, deliberately.** Redis being unreachable must not stop a shopper
      // scanning a tin of beans. A rate limiter is a protection against abuse, not a
      // correctness control — unlike the presence check, which fails closed because it
      // decides whether someone may shop at all.
      //
      // Loud, because a limiter that has silently stopped limiting is one an attacker
      // finds before an operator does.
      console.error(`[ratelimit] Upstash unavailable, allowing request: ${(error as Error).message}`);
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}
