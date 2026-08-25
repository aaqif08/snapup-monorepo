import 'server-only';
import type { StoreRecord } from './types';

/**
 * Whether a branch is actually deployable, and if not, exactly what is missing.
 *
 * This exists because of a specific failure mode. A branch registered from a website
 * listing has a name, an address and a phone number — everything a human needs and none
 * of what the software needs. The two values that matter operationally, the surveyed
 * coordinates and the customer-Wi-Fi egress IP, cannot be looked up or guessed; they
 * come from visiting the shop and from its network provider.
 *
 * Without this check the failure is silent and misattributed:
 *
 *   - Missing coordinates: the branch either vanishes from the nearby list (customer
 *     concludes there is no SnapUp here) or, if seeded as `0, 0`, sorts as though it
 *     were 2 000 km away in the ocean.
 *   - Missing egress CIDR: `validateSession()` fails closed and every shopper is refused
 *     with `presence_not_verified`, which reads as "the app is broken" rather than
 *     "nobody registered this branch's network".
 *
 * Both are indistinguishable from a bug at the point they are noticed. Naming the gap at
 * startup and at the console turns a support ticket into a checklist item.
 */

export type ReadinessGap =
  /** No surveyed latitude/longitude. Excluded from distance ordering. */
  | 'coordinates_missing'
  /** No authorized egress range. The branch cannot grant a shopping session at all. */
  | 'egress_cidrs_missing'
  /** No SSID to tell the customer which network to join. */
  | 'ssid_missing'
  /** No UPI payee. Shoppable, but checkout has to fall back to paying at the counter. */
  | 'merchant_vpa_missing'
  /** `apiKeyRef` names an environment variable that is not set in this deployment. */
  | 'api_key_unresolved';

export interface StoreReadiness {
  storeId: string;
  name: string;
  /** True when nothing blocks a customer from completing a shop here. */
  deployable: boolean;
  /** Gaps that prevent shopping outright. */
  blocking: ReadinessGap[];
  /** Gaps that degrade the experience but still allow a session. */
  advisory: ReadinessGap[];
}

const EXPLANATIONS: Record<ReadinessGap, string> = {
  coordinates_missing:
    'No surveyed coordinates. Stand at the shop entrance, take the reading from Google Maps, and enter it in the admin console.',
  egress_cidrs_missing:
    'No authorized egress CIDR. Ask the branch for the static public IP of its customer Wi-Fi NAT gateway; every shopper is refused until it is registered.',
  ssid_missing: 'No advertised SSID. Customers are not told which network to join.',
  merchant_vpa_missing:
    'No merchant UPI address. Shopping works but checkout must fall back to paying at the counter.',
  api_key_unresolved:
    'apiKeyRef names an environment variable that is not set in this deployment, so calls to this branch would be unauthenticated.',
};

export function explainGap(gap: ReadinessGap): string {
  return EXPLANATIONS[gap];
}

export function hasCoordinates(
  store: Pick<StoreRecord, 'latitude' | 'longitude'>
): store is Pick<StoreRecord, 'latitude' | 'longitude'> & { latitude: number; longitude: number } {
  return typeof store.latitude === 'number' && typeof store.longitude === 'number';
}

/**
 * Assess one branch.
 *
 * `isKeyResolved` is injected rather than read here so this module stays free of
 * `process.env` and can be unit-tested without a fabricated environment.
 */
export function storeReadiness(
  store: StoreRecord,
  { isKeyResolved }: { isKeyResolved?: (ref: string) => boolean } = {}
): StoreReadiness {
  const blocking: ReadinessGap[] = [];
  const advisory: ReadinessGap[] = [];

  // Blocking: without an egress range the presence check can never pass, so the branch
  // is switched on but unusable — the worst of the possible states.
  if (store.authorizedEgressCidrs.length === 0) blocking.push('egress_cidrs_missing');

  if (store.apiKeyRef && isKeyResolved && !isKeyResolved(store.apiKeyRef)) {
    blocking.push('api_key_unresolved');
  }

  // Advisory: the customer can still shop. Coordinates only affect ordering, and a
  // missing VPA falls back to the counter — neither should hide the branch entirely.
  if (!hasCoordinates(store)) advisory.push('coordinates_missing');
  if (store.advertisedSsid.trim().length === 0) advisory.push('ssid_missing');
  if (!store.merchantVpa) advisory.push('merchant_vpa_missing');

  return {
    storeId: store.id,
    name: store.name,
    deployable: blocking.length === 0,
    blocking,
    advisory,
  };
}

/**
 * Startup summary, written to the server log once.
 *
 * Deliberately a log line and not a thrown error: refusing to boot because one branch of
 * eight is unsurveyed would take the whole chain offline to protect one shop. The
 * individual branch already fails closed on its own; this is the operator's reminder of
 * which ones and why.
 */
export function readinessReport(stores: StoreRecord[], isKeyResolved?: (ref: string) => boolean) {
  const results = stores.map((store) => storeReadiness(store, { isKeyResolved }));
  const blocked = results.filter((result) => !result.deployable);
  const incomplete = results.filter((result) => result.deployable && result.advisory.length > 0);

  const lines: string[] = [
    `[stores] ${results.length} registered, ${results.length - blocked.length} deployable.`,
  ];

  for (const result of blocked) {
    lines.push(
      `[stores] BLOCKED ${result.storeId} (${result.name}): ${result.blocking
        .map((gap) => explainGap(gap))
        .join(' ')}`
    );
  }
  for (const result of incomplete) {
    lines.push(
      `[stores] incomplete ${result.storeId} (${result.name}): ${result.advisory.join(', ')}`
    );
  }

  return { results, blocked, incomplete, lines };
}
