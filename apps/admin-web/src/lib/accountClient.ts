'use client';

/**
 * Browser-side console account client.
 *
 * Talks to this app's own `/api/auth/*` and `/api/staff` routes, which relay to the
 * customer app with the caller's session cookie attached. Nothing secret passes through
 * here: the session token is `httpOnly` and the registry's machine credential never
 * leaves the console's server.
 */

export type Role = 'owner' | 'manager' | 'staff' | 'customer';

export interface AccountUser {
  id: string;
  role: Role;
  phone: string | null;
  email: string | null;
  name: string | null;
  storeId: string | null;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  });

  if (!response.ok) {
    let code = 'request_failed';
    let message = `Request failed (${response.status}).`;
    try {
      const payload = await response.json();
      if (payload?.error?.code) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch {
      /* keep the status line */
    }
    throw new AccountError(code, message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface MeResult {
  user: AccountUser | null;
  accounts_durable: boolean;
}

export function fetchMe(): Promise<MeResult> {
  return call<MeResult>('/api/auth/me');
}

export function login(email: string, password: string): Promise<{ user: AccountUser }> {
  return call<{ user: AccountUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export interface SignupResult {
  user: AccountUser;
  /** True when this was the very first console account, which becomes the owner. */
  bootstrap: boolean;
  /** True when an owner still has to activate this account before it can sign in. */
  pending_approval: boolean;
}

export function signup(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<SignupResult> {
  return call<SignupResult>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<{ signed_out: true }> {
  return call<{ signed_out: true }>('/api/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export interface ForgotResult {
  sent: true;
  /** Echoed from what was typed, not from anything stored — a typo check, not a lookup. */
  email_masked: string;
  expires_in_seconds: number;
}

/**
 * Always resolves for a well-formed address, whether or not an account exists. The UI must
 * therefore not phrase its confirmation as "we sent you a link" — see the page copy.
 */
export function requestPasswordReset(email: string): Promise<ForgotResult> {
  return call<ForgotResult>('/api/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export type ResetTokenCheck =
  | { valid: true; email_masked: string }
  | { valid: false; reason?: 'unknown' | 'expired' | 'already_used' };

/** Checks a token without consuming it, so the page can fail early rather than after typing. */
export function checkResetToken(token: string): Promise<ResetTokenCheck> {
  return call<ResetTokenCheck>(`/api/auth/reset?token=${encodeURIComponent(token)}`);
}

/** Sets the new password. Does not sign in — the user logs in with it afterwards. */
export function completePasswordReset(
  token: string,
  password: string
): Promise<{ reset: true; email: string | null }> {
  return call('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface StaffListResult {
  staff: AccountUser[];
  /** Whether the signed-in user may add, edit and remove. Decided by the server. */
  can_manage: boolean;
  actor_id: string;
}

export function listStaff(): Promise<StaffListResult> {
  return call<StaffListResult>('/api/staff');
}

export function createStaff(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role: Exclude<Role, 'customer'>;
  storeId?: string | null;
}): Promise<{ staff: AccountUser; notice: string }> {
  return call('/api/staff', { method: 'POST', body: JSON.stringify(input) });
}

export function updateStaff(
  id: string,
  patch: {
    role?: Exclude<Role, 'customer'>;
    name?: string | null;
    phone?: string | null;
    storeId?: string | null;
    isActive?: boolean;
    password?: string;
  }
): Promise<{ staff: AccountUser }> {
  return call(`/api/staff/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Deactivates rather than deletes — past activity has to stay attributable. */
export function removeStaff(id: string): Promise<{ staff: AccountUser; notice: string }> {
  return call(`/api/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
