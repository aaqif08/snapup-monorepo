import 'server-only';
import type { NextRequest } from 'next/server';
import { PRESENCE_DEV_BYPASS } from './env';
import type { StoreRecord } from './stores';

/**
 * Number of proxies in front of this app that append to `x-forwarded-for`.
 *
 * This matters for correctness, not tidiness: `x-forwarded-for` is a client-settable
 * header. An attacker can send `x-forwarded-for: 198.51.100.24` and, if we naively read
 * the leftmost entry, we would hand them a store session from their sofa. Only the
 * entries appended by infrastructure we control are trustworthy, and those are at the
 * *right* of the list. We therefore index from the right.
 *
 * On Vercel exactly one proxy (the edge network) appends the true client IP, so the
 * default of 1 means "take the last entry".
 */
const TRUSTED_PROXY_HOPS = Number(process.env.SNAPUP_TRUSTED_PROXY_HOPS ?? '1');

export function getEgressIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return null;

  const chain = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length === 0) return null;

  const index = chain.length - TRUSTED_PROXY_HOPS;
  if (index < 0) {
    // Fewer hops than configured: the chain has been truncated or spoofed. Fail closed.
    return null;
  }
  return normalizeIp(chain[index]);
}

/** Strips an IPv4-mapped IPv6 prefix and any zone id, so `::ffff:1.2.3.4` compares as `1.2.3.4`. */
function normalizeIp(ip: string): string {
  const withoutZone = ip.split('%')[0].trim();
  const mapped = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : withoutZone;
}

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split('.');
  if (octets.length !== 4) return null;

  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  // `>>> 0` because JS bitwise ops yield a signed 32-bit int and addresses above
  // 127.255.255.255 would otherwise compare as negative.
  return value >>> 0;
}

export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  // A /0 mask would shift by 32, which is a no-op in JS (shift counts are mod 32),
  // so it is special-cased to "match everything".
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export type PresenceCheck =
  | { present: true; egressIp: string }
  | { present: false; reason: 'no_client_ip' | 'ip_not_authorized' };

/**
 * SDPA presence factor 2. Confirms the request physically originates from the store's
 * network by checking the server-observed source IP against the store's registered
 * egress ranges.
 */
export function verifyNetworkPresence(
  request: NextRequest,
  store: StoreRecord
): PresenceCheck {
  const egressIp = getEgressIp(request);

  if (PRESENCE_DEV_BYPASS) {
    return { present: true, egressIp: egressIp ?? '127.0.0.1' };
  }

  if (!egressIp) return { present: false, reason: 'no_client_ip' };

  const authorized = store.authorizedEgressCidrs.some((cidr) => ipMatchesCidr(egressIp, cidr));
  return authorized
    ? { present: true, egressIp }
    : { present: false, reason: 'ip_not_authorized' };
}
