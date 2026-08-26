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

  /**
   * Decimal degrees, WGS84 — the coordinate system browser geolocation reports in.
   *
   * Null means **not surveyed yet**, and is deliberately distinct from `0, 0`. A branch
   * whose position is unknown must be excluded from the nearby-store ordering rather
   * than sorted as though it were in the Gulf of Guinea, and null is the only value that
   * cannot be mistaken for a real reading. A retailer's published address is not a
   * coordinate: these have to be surveyed per branch and entered, and until they are,
   * `storeReadiness()` reports the branch as not deployable.
   */
  latitude: number | null;
  longitude: number | null;

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

  /**
   * Base URL of *this branch's* retail API.
   *
   * A chain does not necessarily run one system. Branches are commonly acquired at
   * different times, run different POS versions, or sit behind their own site-local
   * server with no central aggregation — so the catalogue endpoint is a property of the
   * branch, not of the platform.
   *
   * Null falls back to the platform-wide `SNAPUP_STORE_API_BASE`, which is what a
   * single-system retailer configures and what existing deployments already use.
   */
  apiBaseUrl: string | null;

  /**
   * *Name* of the environment variable holding this branch's API key — never the key.
   *
   * `apiKeyRef: 'KMB_TRICHY'` resolves to `SNAPUP_STORE_API_KEY_KMB_TRICHY`. The
   * indirection is the point: store records are edited in the admin console, returned by
   * the admin API, and on Postgres are sitting in a table that gets backed up and
   * inspected. A credential in that path is a credential that leaks. The reference is
   * useless without the deployment environment that resolves it.
   *
   * Null falls back to the platform-wide `SNAPUP_STORE_API_KEY`.
   */
  apiKeyRef: string | null;

  /**
   * A key pasted into the console, encrypted at rest. Never returned to any client.
   *
   * Takes precedence over `apiKeyRef`, because someone who typed a key into this branch's
   * settings means that key — falling through to an environment variable they cannot see
   * would be the console lying about which credential is in use.
   *
   * See `stores/credentials.ts`. Null means no pasted key, and resolution falls back to
   * `apiKeyRef` and then to the platform-wide key.
   */
  apiKeySealed: string | null;
  /** `••••••••3f9a` — safe to render. Null when no key is set. */
  apiKeyMasked: string | null;
  /** Non-reversible handle, so the console can say whether the key changed. */
  apiKeyFingerprint: string | null;
  apiKeySetAt: number | null;

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
  /** Null while the branch is awaiting survey — the customer sees an address, not a pin. */
  latitude: number | null;
  longitude: number | null;
  ssid: string;
  isOpen: boolean;
  /** Great-circle distance from the requesting device, when coordinates were supplied. */
  distanceKm?: number;
}

export interface StoreDraft {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  authorizedEgressCidrs: string[];
  advertisedSsid: string;
  merchantVpa: string | null;
  merchantDisplayName: string | null;
  apiBaseUrl: string | null;
  apiKeyRef: string | null;
  /**
   * A key typed into the console, in the clear, on its way to being encrypted.
   *
   * This is the *only* place a branch credential exists as plaintext, and it exists here
   * for exactly one hop: the route seals it (`credentials.seal`) before the repository
   * ever sees a record. It is never read back out — there is no matching field on
   * `StoreRecord`, only the sealed and masked forms, which is what makes "write-only"
   * a property of the types rather than a convention someone has to remember.
   *
   * `undefined` leaves the stored key alone, which is what an edit that does not touch
   * the field must do. `null` clears it. A string sets it.
   */
  apiKey?: string | null;
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

/**
 * The credential fields of a branch that has no pasted key.
 *
 * Spread into every place a `StoreRecord` is built from something that predates the
 * console field — seeds, the retailer-API projection, the in-memory registry. Written
 * once so that adding a fifth credential column is one edit rather than a hunt.
 */
export const NO_STORED_API_KEY = {
  apiKeySealed: null,
  apiKeyMasked: null,
  apiKeyFingerprint: null,
  apiKeySetAt: null,
} as const;
