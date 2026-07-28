import 'server-only';
import type { StoreRecord } from './types';

/**
 * Admin-facing view of a store.
 *
 * Unlike `toPublicStore()` this deliberately includes `authorized_egress_cidrs`:
 * registering that value is the whole purpose of the admin screen, and an operator who
 * cannot see what a store's network is set to cannot distinguish a misconfiguration from
 * a working store. It is reachable only behind `guardAdminRequest`.
 */
export function toAdminStore(store: StoreRecord) {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    authorized_egress_cidrs: store.authorizedEgressCidrs,
    advertised_ssid: store.advertisedSsid,
    is_active: store.isActive,
    is_open: store.isOpen,
  };
}

export type AdminStore = ReturnType<typeof toAdminStore>;

/**
 * Configuration problems surfaced in the console rather than rejected outright.
 *
 * A store with no registered network is a legitimate intermediate state — an operator may
 * add the shop before the supermarket has supplied its gateway IP — but it will refuse
 * every customer until that is filled in. Silently accepting it is how a store ends up
 * live and broken with nobody able to see why.
 */
export function warningsFor(store: StoreRecord): string[] {
  const warnings: string[] = [];

  if (store.authorizedEgressCidrs.length === 0) {
    warnings.push(
      'No authorized network registered. This store will refuse every customer with presence_not_verified until its Wi-Fi gateway IP is added.'
    );
  }

  if (store.isActive && store.authorizedEgressCidrs.some(isDocumentationRange)) {
    warnings.push(
      'This store uses a documentation-only placeholder IP range (RFC 5737). Replace it with the real gateway IP before the store goes live.'
    );
  }

  return warnings;
}

/** RFC 5737 TEST-NET ranges — reserved for documentation, never routable in the wild. */
function isDocumentationRange(cidr: string): boolean {
  return (
    cidr.startsWith('192.0.2.') || cidr.startsWith('198.51.100.') || cidr.startsWith('203.0.113.')
  );
}
