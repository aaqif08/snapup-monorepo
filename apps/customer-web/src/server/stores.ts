import 'server-only';

export interface StoreRecord {
  id: string;
  name: string;
  /**
   * Public egress ranges of the store's customer Wi-Fi, in CIDR notation.
   *
   * This is the technical substitute for the "authorized SSID" check in the CTO
   * requirements report. A browser cannot read the SSID it is connected to — no such
   * API exists — so any SSID the app reported would be self-declared by the client and
   * forgeable by a customer sitting at home. The public source IP of the request is
   * observed by the server instead, and cannot be set by the client.
   *
   * Operationally: the supermarket gives us the static public IP of its customer-Wi-Fi
   * NAT gateway, which is what we register here.
   */
  authorizedEgressCidrs: string[];
  /**
   * Advertised SSID. Displayed to the customer ("connect to SnapUp-Guest") and logged
   * alongside presence decisions. Never trusted as an access control input.
   */
  advertisedSsid: string;
}

const STORES: StoreRecord[] = [
  {
    id: 'store_1',
    name: 'DMart Supercenter',
    // TEST-NET-2 (RFC 5737) placeholders — replace with each store's real NAT egress IP
    // before the pilot. A /32 is correct for a single static gateway address.
    authorizedEgressCidrs: ['198.51.100.24/32'],
    advertisedSsid: 'DMart-Guest',
  },
  {
    id: 'store_2',
    name: 'SnapUp Express',
    authorizedEgressCidrs: ['198.51.100.25/32', '203.0.113.0/28'],
    advertisedSsid: 'SnapUp-Guest',
  },
  {
    id: 'store_3',
    name: 'FreshMart Central',
    authorizedEgressCidrs: ['203.0.113.64/28'],
    advertisedSsid: 'FreshMart-WiFi',
  },
];

const STORE_INDEX = new Map(STORES.map((store) => [store.id, store]));

export function getStore(storeId: string): StoreRecord | undefined {
  return STORE_INDEX.get(storeId);
}
