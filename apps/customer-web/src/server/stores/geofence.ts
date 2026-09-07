import 'server-only';

/**
 * Is the device close enough to the shop?
 *
 * ## What this is, and what it is not
 *
 * It is **not** a security control, and must never be treated as one. The position comes
 * from the browser's geolocation API, which means it comes from the customer's device,
 * which means anyone with developer tools open can claim to be standing anywhere. A
 * geofence built on a client-supplied coordinate can always be walked through.
 *
 * The control that actually holds is the network check: the egress IP is observed by the
 * server on the connection itself and cannot be asserted by the page. That is why the Wi-Fi
 * factor is mandatory and this one is not — this narrows the honest cases, it does not stop
 * the dishonest ones.
 *
 * ## Why accuracy is part of the decision
 *
 * A phone inside a concrete supermarket routinely reports a position 20–50 metres from
 * where it is standing, and says so: `coords.accuracy` is a radius in metres at 95%
 * confidence. Comparing a reading with ±80 m of error against a 50 m fence is comparing
 * noise against a threshold — it would refuse customers standing at the till.
 *
 * So a reading whose own accuracy is worse than the fence is treated as **unknown**, not as
 * outside. Unknown defers to the network check rather than turning anybody away, which is
 * the only defensible reading of a measurement that admits it cannot answer the question.
 */

/** Metres. Roughly a supermarket floor plus its entrance. */
export const DEFAULT_GEOFENCE_RADIUS_M = 50;

export type GeofenceVerdict =
  | { inside: true; distanceM: number }
  | { inside: false; distanceM: number; radiusM: number }
  /** No coordinates, no radius, or a reading too vague to judge against. */
  | { inside: null; reason: 'not_surveyed' | 'no_position' | 'accuracy_too_poor' };

export interface DevicePosition {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, as the browser reports it. */
  accuracyM?: number;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine on a spherical earth. The error against a proper ellipsoid model is well under
 * a metre at these distances, which is an order of magnitude better than the GPS reading it
 * is applied to — a more elaborate formula would be false precision.
 */
export function distanceMetres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function checkGeofence(
  store: { latitude: number | null; longitude: number | null; geofenceRadiusM: number | null },
  position: DevicePosition | null
): GeofenceVerdict {
  // An unsurveyed branch has no centre to measure from. A fence around coordinates that do
  // not exist would refuse everybody, so there is simply no fence.
  if (store.latitude === null || store.longitude === null || store.geofenceRadiusM === null) {
    return { inside: null, reason: 'not_surveyed' };
  }

  if (!position) return { inside: null, reason: 'no_position' };

  const radiusM = store.geofenceRadiusM;

  // A reading that cannot resolve the fence cannot be judged against it. Deferring is the
  // only honest answer; refusing would turn away someone standing at the till.
  if (position.accuracyM !== undefined && position.accuracyM > radiusM) {
    return { inside: null, reason: 'accuracy_too_poor' };
  }

  const distanceM = Math.round(
    distanceMetres(store.latitude, store.longitude, position.latitude, position.longitude)
  );

  return distanceM <= radiusM ? { inside: true, distanceM } : { inside: false, distanceM, radiusM };
}
