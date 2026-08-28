import 'server-only';
import { formatClockTime } from './hours';
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
    merchant_vpa: store.merchantVpa,
    merchant_display_name: store.merchantDisplayName,
    // The endpoint and the *name* of the key variable are both editable here. Neither is a
    // secret: `api_key_ref` is a reference that is worthless without the deployment
    // environment that resolves it, which is exactly why the schema stores a reference
    // rather than a key.
    api_base_url: store.apiBaseUrl,
    api_key_ref: store.apiKeyRef,

    // The pasted key, in the only two forms that may leave the server. `apiKeySealed`
    // is deliberately absent: it is ciphertext, but ciphertext that travels to a
    // browser is ciphertext someone can work on offline, and there is no reason for it
    // to be there. The console needs to know a key exists and whether it changed —
    // that is what these two answer.
    api_key_masked: store.apiKeyMasked,
    api_key_fingerprint: store.apiKeyFingerprint,
    api_key_set_at: store.apiKeySetAt,
    is_active: store.isActive,
    is_open: store.isOpen,
    // Sent as "09:00" rather than 540: the console renders them into time inputs, and a
    // number that has to be divided by sixty before a human can read it is a number that
    // will eventually be shown to one by mistake.
    opens_at: store.opensAtMinutes === null ? null : formatClockTime(store.opensAtMinutes),
    closes_at: store.closesAtMinutes === null ? null : formatClockTime(store.closesAtMinutes),
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

  // Under the phase-1 payment model the customer pays this shop directly, so without a VPA
  // there is no account for the money to go to. Checkout degrades to pay-at-counter rather
  // than failing, which is survivable — but it is a silent loss of the app's main flow, so
  // the console has to say it out loud.
  if (store.merchantVpa === null) {
    warnings.push(
      'No merchant UPI address registered. Customers here can only pay at the counter — in-app UPI checkout is unavailable until the retailer supplies their VPA.'
    );
  }

  // A branch registered from a published address has everything a human needs and none of
  // what the ordering needs. Without this the branch simply falls to the bottom of the
  // directory with no distance shown, which reads as a display bug rather than as missing
  // survey data.
  if (store.latitude === null || store.longitude === null) {
    warnings.push(
      'No surveyed coordinates. This store is listed after every located store and shows no distance. Stand at the entrance, take the reading from Google Maps, and enter it here.'
    );
  }

  // The failure this prevents is the confusing one: the branch is reachable, its key is
  // fine, and every call 404s or returns another branch's catalogue because the endpoint
  // silently fell back to the platform default.
  if (store.apiBaseUrl !== null && store.apiKeyRef === null && store.apiKeySealed === null) {
    warnings.push(
      'A branch API endpoint is set but no key is. Calls for this store will be made ' +
        'with the platform-wide key, and will fail if this branch expects its own. Paste ' +
        'the key into Branch API key, or clear the endpoint.'
    );
  }

  if (store.apiKeyRef !== null && store.apiBaseUrl === null) {
    warnings.push(
      'A branch API key reference is set but no branch API base URL is. Calls for this store will go to the platform-wide endpoint. Set both, or neither.'
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
