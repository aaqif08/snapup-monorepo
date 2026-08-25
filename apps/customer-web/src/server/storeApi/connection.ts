import 'server-only';
import { STORE_API_BASE, STORE_API_KEY } from './config';
import type { StoreRecord } from '../stores/types';

/**
 * Which retailer endpoint a given request should go to.
 *
 * A chain is not necessarily one system. Kurinji Metro Bazaar runs eight branches that
 * were opened at different times across six towns; assuming a single central API would
 * be a guess about somebody else's infrastructure. So the endpoint is resolved per
 * branch, with the platform-wide values as the fallback for retailers who genuinely do
 * run one system.
 *
 * ## The credential never lives in the store record
 *
 * `StoreRecord.apiKeyRef` holds the *name* of an environment variable, not a key. Store
 * records are editable in the admin console, returned by the admin API, and on Postgres
 * are sitting in a backed-up table. Anything secret on that path is a secret that leaks.
 * The reference is worthless without the deployment that resolves it.
 *
 * ## Why the store registry itself is excluded
 *
 * Only branch-scoped data — catalogue, orders, analytics — is routed this way. The store
 * *registry* always uses the platform connection, because resolving a branch's endpoint
 * requires reading that branch's record, and reading it from its own endpoint is a cycle
 * with no base case. Someone has to know where the branches are before you can ask them
 * anything.
 */

export interface StoreApiConnection {
  baseUrl: string;
  key: string;
  /** For logs and errors. Never contains the key. */
  label: string;
}

const KEY_ENV_PREFIX = 'SNAPUP_STORE_API_KEY_';
const BASE_ENV_PREFIX = 'SNAPUP_STORE_API_BASE_';

/** Environment variable name for a key reference, e.g. `KMB_TRICHY`. */
export function keyEnvName(ref: string): string {
  return `${KEY_ENV_PREFIX}${ref.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function baseEnvName(ref: string): string {
  return `${BASE_ENV_PREFIX}${ref.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function isKeyResolved(ref: string): boolean {
  return (process.env[keyEnvName(ref)] ?? '').length > 0;
}

/**
 * The platform-wide connection: the store registry, and the fallback for branches that
 * have not been given their own endpoint.
 */
export function platformConnection(): StoreApiConnection | null {
  if (STORE_API_BASE.length === 0 || STORE_API_KEY.length === 0) return null;
  return { baseUrl: STORE_API_BASE, key: STORE_API_KEY, label: 'platform' };
}

/**
 * Resolve the connection for one branch.
 *
 * Returns null when the branch names a key reference the deployment cannot resolve —
 * rather than quietly falling back to the platform key. Falling back would send one
 * branch's request authenticated as another, which for a chain where each branch hosts
 * its own database is a cross-tenant call, not a convenience.
 */
export function connectionForStore(
  store: Pick<StoreRecord, 'id' | 'apiBaseUrl' | 'apiKeyRef'>
): StoreApiConnection | null {
  const platform = platformConnection();

  // Neither overridden: this retailer runs one system.
  if (!store.apiBaseUrl && !store.apiKeyRef) return platform;

  const baseUrl =
    store.apiBaseUrl ??
    (store.apiKeyRef ? process.env[baseEnvName(store.apiKeyRef)] : undefined) ??
    platform?.baseUrl;

  const key = store.apiKeyRef
    ? (process.env[keyEnvName(store.apiKeyRef)] ?? '')
    : (platform?.key ?? '');

  if (!baseUrl || key.length === 0) return null;

  return { baseUrl, key, label: store.id };
}

/**
 * Why a connection could not be resolved, for logs and the admin console.
 *
 * Separate from `connectionForStore` so the hot path returns a simple null while the
 * diagnostic — which is only ever read by a human — does the string building.
 */
export function explainMissingConnection(
  store: Pick<StoreRecord, 'id' | 'apiBaseUrl' | 'apiKeyRef'>
): string {
  if (store.apiKeyRef && !isKeyResolved(store.apiKeyRef)) {
    return `${store.id}: ${keyEnvName(store.apiKeyRef)} is not set in this deployment.`;
  }
  if (!store.apiBaseUrl && !platformConnection()) {
    return `${store.id}: no apiBaseUrl on the store and no platform SNAPUP_STORE_API_BASE.`;
  }
  return `${store.id}: store API is not configured.`;
}
