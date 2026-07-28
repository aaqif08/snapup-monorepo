import { useSessionStore, type SessionStatus } from '@/store/useSessionStore';
import type { Product } from '@/store/useCartStore';

/**
 * Client-side gateway wrapper. Every call to the product database goes through here.
 *
 * Note what this file does NOT contain: any product data. The catalogue lives only in
 * `src/server/products/`, which is guarded by `server-only` and therefore cannot be
 * imported into a client bundle even by accident.
 */

export interface ApiError {
  code: string;
  message: string;
}

class GatewayError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** Maps a server rejection onto the session status the UI should show. */
function statusForCode(code: string): Exclude<SessionStatus, 'active' | 'idle'> | null {
  switch (code) {
    case 'presence_lost':
      return 'presence_lost';
    case 'expired':
      return 'expired';
    case 'revoked':
      return 'ended';
    // Any other 401 means the token is unusable (bad signature, wrong version, absent).
    // Treat it as an ended session rather than leaving the UI in a stuck state.
    case 'missing_token':
    case 'malformed':
    case 'bad_signature':
    case 'unknown_version':
      return 'ended';
    default:
      return null;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    if (body?.error?.code) return body.error as ApiError;
  } catch {
    // Fall through to a generic error below.
  }
  return { code: 'request_failed', message: `Request failed (${response.status}).` };
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = useSessionStore.getState().token;
  if (!token) throw new GatewayError('missing_token', 'No active shopping session.', 401);

  const response = await fetch(path, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  });

  if (response.status === 401 || response.status === 403) {
    const error = await parseError(response);
    const status = statusForCode(error.code);
    // The server is the authority on presence. When it says the session is gone, tear
    // down the local session immediately rather than waiting for a heartbeat to notice.
    if (status) useSessionStore.getState().invalidate(status);
    throw new GatewayError(error.code, error.message, response.status);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Store directory
// ---------------------------------------------------------------------------

export interface NearbyStore {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  ssid: string;
  isOpen: boolean;
  /** Absent when the customer has not shared their location. */
  distanceKm?: number;
}

export interface NearbyStoresResult {
  stores: NearbyStore[];
  /** False when the list is unordered because no coordinates were supplied. */
  located: boolean;
}

/**
 * Fetches the store directory, ordered by real distance when coordinates are given.
 *
 * Distance is computed server-side. The device's coordinates go up and the ordering comes
 * back, rather than the client being handed every store's position to sort locally —
 * which also means the response never carries stores outside the requested radius.
 */
export async function fetchNearbyStores(
  coords?: { latitude: number; longitude: number },
  radiusKm?: number
): Promise<NearbyStoresResult> {
  const params = new URLSearchParams();
  if (coords) {
    params.set('lat', String(coords.latitude));
    params.set('lng', String(coords.longitude));
    if (radiusKm !== undefined) params.set('radius_km', String(radiusKm));
  }

  const query = params.toString();
  const response = await fetch(`/api/stores/nearby${query ? `?${query}` : ''}`);

  if (!response.ok) {
    const error = await parseError(response);
    throw new GatewayError(error.code, error.message, response.status);
  }

  const body = await response.json();
  return { stores: body.stores as NearbyStore[], located: Boolean(body.located) };
}

// ---------------------------------------------------------------------------
// Session lifecycle (Requirement 1)
// ---------------------------------------------------------------------------

export async function startSession(qrToken: string): Promise<void> {
  const response = await fetch('/api/session/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qr_token: qrToken }),
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new GatewayError(error.code, error.message, response.status);
  }

  const body = await response.json();
  useSessionStore.getState().setSession({
    token: body.session_token,
    storeId: body.store.id,
    storeName: body.store.name,
    expiresAt: body.expires_at,
  });
}

export interface HeartbeatResult {
  active: boolean;
  expiresInSeconds?: number;
}

export async function sendHeartbeat(): Promise<HeartbeatResult> {
  const token = useSessionStore.getState().token;
  if (!token) return { active: false };

  const response = await fetch('/api/session/heartbeat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) return { active: false };

  const body = await response.json();
  if (!body.active) {
    const status = statusForCode(body.reason) ?? 'ended';
    useSessionStore.getState().invalidate(status);
    return { active: false };
  }

  return { active: true, expiresInSeconds: body.expires_in_seconds };
}

export async function endSession(): Promise<void> {
  const token = useSessionStore.getState().token;
  if (token) {
    // Best-effort: if this fails the token still expires on its own, so the customer
    // should never be blocked on it.
    await fetch('/api/session/end', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  useSessionStore.getState().invalidate('ended');
  productCache.clear();
}

// ---------------------------------------------------------------------------
// Product lookup (Requirements 2, 3, 4)
// ---------------------------------------------------------------------------

interface CacheEntry {
  product: Product;
  cachedAt: number;
}

/**
 * Session-scoped lookup cache (Requirement 3).
 *
 * Rescanning the same item — which shoppers do constantly, buying three of the same
 * yoghurt — should not hit the network at all. Cleared whenever the session ends so a
 * new session at a different store can never serve the previous store's prices.
 */
const productCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface LookupResult {
  product: Product;
  /** Server-measured database lookup time, in ms. */
  serverLookupMs: number;
  /** Total wall-clock time as the customer experiences it, in ms. */
  totalMs: number;
  source: 'network' | 'cache';
}

export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  const startedAt = performance.now();

  const cached = productCache.get(barcode);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return {
      product: cached.product,
      serverLookupMs: 0,
      totalMs: Math.round((performance.now() - startedAt) * 100) / 100,
      source: 'cache',
    };
  }

  const response = await authedFetch(`/api/products/barcode/${encodeURIComponent(barcode)}`);

  if (response.status === 404) {
    throw new GatewayError('product_not_found', 'This item was not found in this store.', 404);
  }
  if (!response.ok) {
    const error = await parseError(response);
    throw new GatewayError(error.code, error.message, response.status);
  }

  const body = await response.json();
  const product: Product = body.product;

  productCache.set(barcode, { product, cachedAt: Date.now() });

  return {
    product,
    serverLookupMs: body.lookup_ms ?? 0,
    totalMs: Math.round((performance.now() - startedAt) * 100) / 100,
    source: 'network',
  };
}

export interface ProductSearchPage {
  items: Product[];
  page: { page: number; page_size: number; total: number; total_pages: number; has_next: boolean };
  lookupMs: number;
}

/** Paginated in-store product search (Requirement 4). */
export async function searchProducts(
  query: string,
  page = 1,
  pageSize = 20
): Promise<ProductSearchPage> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: String(pageSize),
  });

  const response = await authedFetch(`/api/products/search?${params}`);
  if (!response.ok) {
    const error = await parseError(response);
    throw new GatewayError(error.code, error.message, response.status);
  }

  const body = await response.json();
  return { items: body.items, page: body.page, lookupMs: body.lookup_ms ?? 0 };
}

export { GatewayError };
