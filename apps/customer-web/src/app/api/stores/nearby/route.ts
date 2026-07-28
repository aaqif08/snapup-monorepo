import { NextResponse, type NextRequest } from 'next/server';
import { findNearbyStores, isValidLatitude, isValidLongitude } from '@/server/stores';
import { getEgressIp } from '@/server/network';
import { consumeToken } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 200;
const MAX_LIMIT = 50;

/**
 * Customer-facing store directory.
 *
 * Deliberately unauthenticated: this is the screen a shopper sees *before* they have a
 * session, and the data — shop name, street address, opening state — is public
 * information equivalent to a maps listing. It is not the product database, and it is not
 * covered by Requirement 2's restrictions.
 *
 * What it does not return is `authorizedEgressCidrs`. That is the value the presence
 * check tests against, and publishing it would tell an attacker precisely which network
 * to try to appear to originate from. `toPublicStore()` withholds it by construction.
 *
 * Coordinates are optional. A customer who declines location access still gets the
 * directory, just unordered and without distances — which is the honest answer, rather
 * than the fixed made-up distances the previous mock data returned to everyone.
 */
export async function GET(request: NextRequest) {
  // Throttled by source IP: unauthenticated, and the natural endpoint to walk if someone
  // wanted to enumerate every location SnapUp operates in.
  const limit = consumeToken(`stores-nearby:${getEgressIp(request) ?? 'unknown'}`, 60, 2);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests.' } },
      {
        status: 429,
        headers: { 'retry-after': String(limit.retryAfterSeconds), 'cache-control': 'no-store' },
      }
    );
  }

  const params = request.nextUrl.searchParams;

  const rawLat = params.get('lat');
  const rawLng = params.get('lng');

  let latitude: number | undefined;
  let longitude: number | undefined;

  // Both or neither. A lone coordinate is a client bug, and silently treating it as "no
  // location" would hide that while quietly returning a differently-ordered list.
  if (rawLat !== null || rawLng !== null) {
    // Parsed via a helper rather than bare Number(), because Number(null) and Number('')
    // are both 0 — a valid-looking coordinate. A request with only `lat` would otherwise
    // be silently answered as if the customer were at longitude 0, in the Gulf of Guinea,
    // and return an empty list that looks like "no stores near you" rather than an error.
    const parsedLat = parseCoordinate(rawLat);
    const parsedLng = parseCoordinate(rawLng);

    if (
      parsedLat === null ||
      parsedLng === null ||
      !isValidLatitude(parsedLat) ||
      !isValidLongitude(parsedLng)
    ) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_coordinates',
            message: 'lat and lng must both be supplied and within valid ranges.',
          },
        },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      );
    }

    latitude = parsedLat;
    longitude = parsedLng;
  }

  const radiusKm = clampNumber(params.get('radius_km'), DEFAULT_RADIUS_KM, MAX_RADIUS_KM);
  const limitCount = clampNumber(params.get('limit'), MAX_LIMIT, MAX_LIMIT);

  const stores = await findNearbyStores({
    latitude,
    longitude,
    radiusKm: latitude === undefined ? undefined : radiusKm,
    limit: limitCount,
  });

  return NextResponse.json(
    {
      stores,
      located: latitude !== undefined,
      radius_km: latitude === undefined ? null : radiusKm,
    },
    {
      status: 200,
      headers: {
        // Private despite being public information: the response is shaped by the
        // customer's own coordinates, so a shared cache would serve one shopper's
        // neighbourhood ordering to another.
        'cache-control': 'private, max-age=30',
      },
    }
  );
}

/** Strict numeric parse: absent, empty and non-numeric all become null, never 0. */
function parseCoordinate(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function clampNumber(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, max);
}
