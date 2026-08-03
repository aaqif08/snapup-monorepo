import 'server-only';

/**
 * A store as the business holds it.
 *
 * Two fields here are operational rather than customer-facing and must never be
 * serialised to a shopper — see `projection.ts`:
 *
 *   - `authorizedEgressCidrs` is the store's network topology. Publishing it would tell
 *     an attacker exactly which source IP to try to originate from, and `apiAuth.ts`
 *     already takes care never to echo which CIDR was checked on a failed presence test.
 *   - `isActive` gates whether the store is offered at all.
 */
export interface StoreRecord {
  id: string;
  name: string;
  address: string;

  /** Decimal degrees, WGS84 — the coordinate system browser geolocation reports in. */
  latitude: number;
  longitude: number;

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
   * NAT gateway, which is what gets registered here.
   *
   * A store with an empty list can never grant a session. That is deliberate — it fails
   * closed, so a store added without its network details refuses shoppers rather than
   * admitting everyone.
   */
  authorizedEgressCidrs: string[];

  /**
   * Advertised SSID. Displayed to the customer ("connect to SnapUp-Guest") and logged
   * alongside presence decisions. Never trusted as an access control input.
   */
  advertisedSsid: string;

  /**
   * The shop's own UPI merchant address, which customer payments are sent to directly.
   *
   * Phase 1 of the payment model: money never touches SnapUp, it goes straight from the
   * customer to this shop's account, and SnapUp invoices its service charge separately.
   * That makes the payee a property of the *store*, not a platform-wide constant — which
   * is what `lib/upi.ts` assumed with its single `PLACEHOLDER_MERCHANT_VPA`.
   *
   * Null until the retailer supplies it. A store in that state can still be shopped, but
   * checkout has nowhere to send money, so the UI must fall back to paying at the counter
   * rather than presenting a link that silently pays nobody.
   */
  merchantVpa: string | null;

  /** Name shown inside the customer's UPI app when confirming payment. */
  merchantDisplayName: string | null;

  /** Whether SnapUp is currently offered here. Inactive stores are hidden and refused. */
  isActive: boolean;

  /** Local opening state, shown in the directory. Not an access control input. */
  isOpen: boolean;
}

/**
 * Exactly what a customer may see about a store.
 *
 * The directory itself is public information — name, address, opening state — equivalent
 * to what a maps listing shows, so this is served unauthenticated. What it withholds is
 * the network registration.
 */
export interface PublicStore {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  ssid: string;
  isOpen: boolean;
  /** Great-circle distance from the requesting device, when coordinates were supplied. */
  distanceKm?: number;
}

export interface StoreDraft {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  authorizedEgressCidrs: string[];
  advertisedSsid: string;
  merchantVpa: string | null;
  merchantDisplayName: string | null;
  isActive: boolean;
  isOpen: boolean;
}

/**
 * The seam that lets the registry move to Postgres without touching callers.
 *
 * `findById` is on the request-authentication hot path (every product call re-checks the
 * store's authorization), so a real implementation should cache — store config is a
 * handful of rows that change rarely, and per-request round trips would be wasteful
 * rather than incorrect.
 */
export interface StoreRepository {
  findById(id: string): Promise<StoreRecord | null>;
  /** Active stores only, for the customer-facing directory. */
  listActive(): Promise<StoreRecord[]>;
  /** Every store including inactive ones, for the admin console. */
  listAll(): Promise<StoreRecord[]>;
  create(draft: StoreDraft): Promise<StoreRecord>;
  update(id: string, patch: Partial<StoreDraft>): Promise<StoreRecord | null>;
}
