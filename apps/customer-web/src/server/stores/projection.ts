import 'server-only';
import type { PublicStore, StoreRecord } from './types';

/**
 * The single point at which a store record becomes customer-visible data.
 *
 * Allowlist by construction, for the same reason `products/projection.ts` is: fields are
 * copied out one at a time, so an operational column added to `StoreRecord` later is
 * never exposed by default.
 *
 * The field this exists to withhold is `authorizedEgressCidrs`. Publishing a store's
 * registered network range would hand an attacker the exact value the presence check
 * tests against — the one piece of information that makes a spoofing attempt worth
 * attempting. `advertisedSsid` is deliberately *not* withheld: the customer needs to be
 * told which Wi-Fi to join, and it is printed on the wall of the shop anyway.
 *
 * `apiBaseUrl` and `apiKeyRef` are withheld for the same reason as the CIDR list. Neither
 * is a secret on its own, but together they name the retailer's internal endpoint and the
 * credential slot that opens it — infrastructure detail a shopper has no use for and an
 * attacker does. The allowlist above means they were never exposed by default; this note
 * is here so nobody adds them on the assumption that a URL is harmless.
 */
export function toPublicStore(store: StoreRecord, distanceKm?: number): PublicStore {
  const projected: PublicStore = {
    id: store.id,
    name: store.name,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    ssid: store.advertisedSsid,
    isOpen: store.isOpen,
  };

  if (distanceKm !== undefined) {
    // One decimal place: the directory shows "1.2 km", and publishing more precision
    // than is displayed only narrows where the customer is standing.
    projected.distanceKm = Math.round(distanceKm * 10) / 10;
  }

  return projected;
}
