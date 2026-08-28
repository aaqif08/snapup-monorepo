import 'server-only';
import { NO_STATED_HOURS, NO_STORED_API_KEY, type StoreRecord } from './types';

/**
 * Initial store registry — Kurinji Metro Bazaar, the pilot retailer.
 *
 * Names and addresses are transcribed from the branch listing published at
 * kurinjimetrobazaar.com. Everything else on these records is deliberately empty,
 * because everything else has to be measured rather than looked up.
 *
 * ## Why every coordinate is null
 *
 * The retailer publishes addresses, not coordinates. A street address is not a position:
 * geocoding "108, East Main Street, Thanjavur" lands somewhere on that street, which is
 * good enough to drive to and useless for a presence check or a nearest-branch ordering
 * between two shops in the same town.
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
 * ## Branch contact numbers, from the same listing
 *
 * Not modelled on `StoreRecord` — kept here so the onboarding call has them to hand.
 *
 *   store_1 Trichy (Kattur)   +91 63844 11744    store_5 Mayiladuthurai +91 81100 00738
 *   store_2 Thanjavur 1       +91 82206 66680    store_6 Pudukkottai    +91 74184 33354
 *   store_3 Thanjavur 2       +91 96009 00114    store_7 Mannargudi     +91 98944 30533
 *   store_4 Kumbakonam        +91 89401 00300    store_8 Natchiarkoil   +91 82200 05728
 *
 * See docs/branch-onboarding.md for the full checklist.
 */

/** Shared by every branch until each supplies its own. Kept in one place so a chain-wide
 *  correction is one edit rather than eight. */
const AWAITING_SURVEY = {
  latitude: null,
  longitude: null,
  authorizedEgressCidrs: [] as string[],
  merchantVpa: null,
  merchantDisplayName: null,
  ...NO_STORED_API_KEY,
  ...NO_STATED_HOURS,
} as const;

export const STORE_SEED: StoreRecord[] = [
  {
    id: 'store_1',
    name: 'Kurinji Metro Bazaar — Trichy',
    address: '60/4 A1C Singaram Nagar, Kattur, Tiruchirappalli',
    advertisedSsid: 'KMB-Trichy-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_TRICHY',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_2',
    name: 'Kurinji Metro Bazaar — Thanjavur East Main',
    address: '108, East Main Street, Thanjavur',
    advertisedSsid: 'KMB-Thanjavur-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_THANJAVUR_1',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_3',
    name: 'Kurinji Metro Bazaar — Thanjavur New Housing Unit',
    address: '30, New Housing Unit, Thanjavur',
    advertisedSsid: 'KMB-Thanjavur-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_THANJAVUR_2',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_4',
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
    id: 'store_5',
    name: 'Kurinji Metro Bazaar — Mayiladuthurai',
    address: '11, Pattamangala Street, Mayiladuthurai',
    advertisedSsid: 'KMB-Mayiladuthurai-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_MAYILADUTHURAI',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_6',
    name: 'Kurinji Metro Bazaar — Pudukkottai',
    address: '1319, North Main Street, Pudukkottai',
    advertisedSsid: 'KMB-Pudukkottai-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_PUDUKKOTTAI',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_7',
    name: 'Kurinji Metro Bazaar — Mannargudi',
    address: '60, Kaasukara Street, Mannargudi',
    advertisedSsid: 'KMB-Mannargudi-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_MANNARGUDI',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
  {
    id: 'store_8',
    name: 'Kurinji Metro Bazaar — Natchiarkoil',
    address: '840/1, Main Road, Natchiarkoil',
    advertisedSsid: 'KMB-Natchiarkoil-Guest',
    apiBaseUrl: null,
    apiKeyRef: 'KMB_NATCHIARKOIL',
    isActive: true,
    isOpen: true,
    ...AWAITING_SURVEY,
  },
];
