import 'server-only';
import { NO_GEOFENCE, NO_STATED_HOURS, NO_WIFI_CREDENTIALS, NO_STORED_API_KEY, type StoreRecord } from './types';

/**
 * Initial store registry — the Kumbakonam pilot.
 *
 * Two records, and only two. The pilot launches at the Kumbakonam branch alone, so the
 * other seven Kurinji Metro Bazaar shops that used to sit here have been removed rather
 * than left `isActive: false` — a registry that lists shops the pilot will not serve
 * invites somebody to register a network against one by mistake, and every id below it
 * shifted when they went. `store_2` is a test bench, not a shop.
 *
 * Name and address are transcribed from the branch listing published at
 * kurinjimetrobazaar.com. Everything else on these records is deliberately empty,
 * because everything else has to be measured rather than looked up.
 *
 * ## Why every coordinate is null
 *
 * The retailer publishes addresses, not coordinates. A street address is not a position:
 * geocoding "332, Nageswaran North, Kumbakonam" lands somewhere on that street, which is
 * good enough to drive to and useless for a 50 m presence check at the entrance.
 *
 * Seeding a plausible-looking guess would be the worst option available. It boots, it
 * sorts, it looks surveyed, and it is silently wrong — and once committed there is
 * nothing to distinguish a guessed coordinate from a measured one. `null` means
 * "nobody has been there yet" and `storeReadiness()` says so out loud.
 *
 * To fill one in: stand at the shop entrance, drop a pin in Google Maps, long-press it,
 * copy the decimal degrees, and enter them in the admin console. Six decimal places is
 * far more than enough.
 *
 * ## Why every egress CIDR is empty
 *
 * The presence check tests the public source IP of the request against this list. That
 * value is the static IP of the branch's customer-Wi-Fi NAT gateway, which only the
 * branch's ISP or network installer can tell us. The previous seed used RFC 5737
 * documentation addresses as placeholders; an empty list is better, because an empty
 * list is visibly unconfigured whereas `198.51.100.24/32` looks like a real registration
 * that simply never matches.
 *
 * Empty fails closed: the branch refuses every shopper until its network is registered.
 *
 * ## Kumbakonam's contact number, from the same listing
 *
 * Not modelled on `StoreRecord` — kept here so the onboarding call has it to hand.
 *
 *   store_1 Kumbakonam  +91 89401 00300
 *
 * See docs/branch-onboarding.md for the full checklist.
 */

/** Shared by both records until each supplies its own. */
const AWAITING_SURVEY = {
  latitude: null,
  longitude: null,
  authorizedEgressCidrs: [] as string[],
  merchantVpa: null,
  merchantDisplayName: null,
  ...NO_STORED_API_KEY,
  ...NO_STATED_HOURS,
  ...NO_GEOFENCE,
  ...NO_WIFI_CREDENTIALS,
} as const;

export const STORE_SEED: StoreRecord[] = [
  {
    id: 'store_1',
    name: 'Kurinji Metro Bazaar — Kumbakonam',
    address: '332, Nageswaran North, Kumbakonam',
    advertisedSsid: 'KMB-Kumbakonam-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_KUMBAKONAM',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    // The bench, not a shop. It exists so the whole journey — scan, price, pay, exit
    // code — can be walked through on a home network, without standing in Kumbakonam.
    //
    // Position and network are left blank *here* while being set in the pilot database,
    // because both describe somebody's house rather than the software. They live in
    // `data/demo-store.csv`; whoever runs the bench next has a different house and a
    // different ISP lease, and a hard-coded pair would quietly point their fence at the
    // last person's address.
    //
    // A surveyed bench does run a real 50 m fence, the same as the shop. That is safe to
    // test against because `checkGeofence` defers rather than refuses whenever it cannot
    // answer: no position offered, or a reading whose own accuracy is worse than the
    // fence. The case it will refuse is a browser that reports a confident position that
    // is simply wrong — laptop Wi-Fi geolocation does this — so test on a phone, or widen
    // `geofence_radius_m` for the bench.
    id: 'store_2',
    name: 'SnapUp Test — Home Wi-Fi',
    address: 'Test bench — not a retail location',
    advertisedSsid: 'Home-WiFi',
    apiBaseUrl: null,
    apiKeyRef: null,
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
];
