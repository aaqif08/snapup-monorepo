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
  latitude: number;
  longitude: number;
  authorized_egress_cidrs: string[];
  advertised_ssid: string;
  is_active: boolean;
  is_open: boolean;
}

export interface StoreDraft {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  authorizedEgressCidrs: string[];
  advertisedSsid: string;
  isActive: boolean;
  isOpen: boolean;
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
  if (draft.isActive !== undefined) wire.isActive = draft.isActive;
  if (draft.isOpen !== undefined) wire.isOpen = draft.isOpen;
  return wire;
}
