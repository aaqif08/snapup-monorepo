import 'server-only';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Sweep idle buckets so the map cannot grow without bound on a long-lived instance.
 * Runs opportunistically on write rather than on a timer, since a timer would keep a
 * serverless instance alive.
 */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(now: number, idleMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > idleMs) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Token-bucket rate limiter: `capacity` requests, refilling at `refillPerSecond`.
 * Allows a burst (a customer scanning a few items quickly) while capping sustained
 * throughput, which is what a scraper walking the barcode space would need.
 *
 * NOTE: this is per-instance memory. Under serverless fan-out the effective limit is
 * roughly capacity x instance count. It is adequate for the POC, but a pilot with real
 * traffic should move this to a shared store (Redis / Vercel KV) so the limit is global.
 */
export function consumeToken(
  key: string,
  capacity: number,
  refillPerSecond: number
): RateLimitResult {
  const now = Date.now();
  sweep(now, (capacity / refillPerSecond) * 1000 * 10);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(deficit / refillPerSecond)),
    };
  }

  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}
