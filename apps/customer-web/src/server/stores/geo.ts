import 'server-only';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Haversine rather than a flat-earth approximation: an equirectangular shortcut needs a
 * cos(latitude) correction to avoid overstating east-west distance, and getting that
 * wrong reorders the "nearest stores" list. At city scale the cost of doing it properly
 * is a few trig calls per store, which is nothing against the network round trip.
 *
 * Distance is computed on the **server**. The device's coordinates are sent up and the
 * ordering comes back down, so the client cannot claim to be somewhere it isn't and have
 * that claim mean anything beyond which stores it is shown. Presence for database access
 * is a separate, non-negotiable check — see `network.ts`.
 */
export function distanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rejects NaN, Infinity and out-of-range values before they reach the distance maths. */
export function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}
