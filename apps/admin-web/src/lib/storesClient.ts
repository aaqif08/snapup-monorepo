'use client';

/**
 * Browser-side client for the store registry.
 *
 * Calls this app's own `/api/stores` routes, never the SnapUp registry directly — the
 * credential for that lives on the server. Nothing here needs or has a secret.
 */

export interface AdminStore {
  id: string;
  name: string;
  address: string;
  /** Null until the branch has been surveyed. Not `0` — see the form's help text. */
  latitude: number | null;
  longitude: number | null;
  authorized_egress_cidrs: string[];
  advertised_ssid: string;
  /** The shop's own UPI address. Customer payments go here directly, not to SnapUp. */
  merchant_vpa: string | null;
  merchant_display_name: string | null;
  /** This branch's own retail API. Null means the platform-wide endpoint is used. */
  api_base_url: string | null;
  /** The *name* of the environment variable holding this branch's key, never the key. */
  api_key_ref: string | null;

  /**
   * A key pasted into this console, in the only forms the server will part with.
   *
   * There is no `api_key` here and there must never be: the key is sealed server-side
   * and has no read path. `api_key_masked` says a key exists, `api_key_fingerprint`
   * says which one, and neither can be used to authenticate anything.
   */
  api_key_masked: string | null;
  api_key_fingerprint: string | null;
  api_key_set_at: number | null;
  is_active: boolean;
  is_open: boolean;
  /** `"09:00"`, or null when the branch has not stated hours. */
  opens_at: string | null;
  closes_at: string | null;
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
  isActive: boolean;
  isOpen: boolean;
  /** `"09:00"`, or null to state no hours. Sent as a clock time, stored as minutes. */
  opensAt?: string | null;
  closesAt?: string | null;
  /**
   * Write-only. Omitted keeps the stored key, null clears it, a string replaces it —
   * there is no field it can ever be read back out of.
   */
  apiKey?: string | null;
}

export class RegistryError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'RegistryError';
  }
}

async function readError(response: Response): Promise<RegistryError> {
  try {
    const body = await response.json();
    if (body?.error?.code) {
      return new RegistryError(body.error.code, body.error.message, response.status);
    }
  } catch {
    /* fall through */
  }
  return new RegistryError('request_failed', `Request failed (${response.status}).`, response.status);
}

export async function listStores(): Promise<AdminStore[]> {
  const response = await fetch('/api/stores', { cache: 'no-store' });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return body.stores as AdminStore[];
}

export interface SaveResult {
  store: AdminStore;
  /** Non-blocking configuration problems, e.g. a placeholder or missing network range. */
  warnings: string[];
}

export async function createStore(draft: StoreDraft): Promise<SaveResult> {
  const response = await fetch('/api/stores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toWire(draft)),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return { store: body.store, warnings: body.warnings ?? [] };
}

export async function updateStore(id: string, patch: Partial<StoreDraft>): Promise<SaveResult> {
  const response = await fetch(`/api/stores/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toWire(patch)),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return { store: body.store, warnings: body.warnings ?? [] };
}

/** The registry API speaks camelCase on input and snake_case on output. */
function toWire(draft: Partial<StoreDraft>): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (draft.name !== undefined) wire.name = draft.name;
  if (draft.address !== undefined) wire.address = draft.address;
  if (draft.latitude !== undefined) wire.latitude = draft.latitude;
  if (draft.longitude !== undefined) wire.longitude = draft.longitude;
  if (draft.authorizedEgressCidrs !== undefined) {
    wire.authorizedEgressCidrs = draft.authorizedEgressCidrs;
  }
  if (draft.advertisedSsid !== undefined) wire.advertisedSsid = draft.advertisedSsid;
  if (draft.merchantVpa !== undefined) wire.merchantVpa = draft.merchantVpa;
  if (draft.merchantDisplayName !== undefined) {
    wire.merchantDisplayName = draft.merchantDisplayName;
  }
  if (draft.apiBaseUrl !== undefined) wire.apiBaseUrl = draft.apiBaseUrl;
  if (draft.apiKeyRef !== undefined) wire.apiKeyRef = draft.apiKeyRef;
  if (draft.isActive !== undefined) wire.isActive = draft.isActive;
  if (draft.isOpen !== undefined) wire.isOpen = draft.isOpen;
  return wire;
}
