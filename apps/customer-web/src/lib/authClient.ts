'use client';

/**
 * Browser-side auth client.
 *
 * Every call goes to this app's own routes and relies on the `snapup_account` cookie,
 * which is `httpOnly` — so there is no token for this module to hold, and no token for an
 * XSS bug to read. `credentials: 'same-origin'` is explicit on each request because a
 * cookie that is not sent is indistinguishable from a session that does not exist.
 */

export type Role = 'owner' | 'manager' | 'staff' | 'customer';

export interface AccountUser {
  id: string;
  role: Role;
  phone: string | null;
  username: string | null;
  email: string | null;
  name: string | null;
  storeId: string | null;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    // The server's message is written for the person reading it — "that code is not right,
    // or it has expired" beats anything this layer could invent from a status code.
    let code = 'request_failed';
    let message = `Request failed (${response.status}).`;
    try {
      const payload = await response.json();
      if (payload?.error?.code) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch {
      /* non-JSON body; keep the status line */
    }
    throw new AuthError(code, message, response.status);
  }

  return (await response.json()) as T;
}

export interface OtpRequestResult {
  sent: true;
  phone_masked: string;
  expires_in_seconds: number;
  delivery: 'sms' | 'log';
  /** Present only when the server is delivering codes to its own log. Dev convenience. */
  dev_code?: string;
}

export function requestOtp(phone: string): Promise<OtpRequestResult> {
  return post<OtpRequestResult>('/api/auth/otp/request', { phone });
}

export function verifyOtp(phone: string, code: string, name?: string): Promise<{ user: AccountUser }> {
  return post<{ user: AccountUser }>('/api/auth/otp/verify', { phone, code, name });
}

/**
 * Register a shopper.
 *
 * The pilot uses a username and a password; OTP is excluded, and the request endpoints
 * behind it stay in place for staff rather than being deleted for a temporary product
 * decision.
 */
export function register(input: {
  username: string;
  password: string;
  confirmPassword: string;
  email?: string;
  name?: string;
}): Promise<{ user: AccountUser }> {
  return post<{ user: AccountUser }>('/api/auth/register', input);
}

/** Sign a shopper in. Every failure returns the same message by design. */
export function signIn(username: string, password: string): Promise<{ user: AccountUser }> {
  return post<{ user: AccountUser }>('/api/auth/signin', { username, password });
}

export function consoleLogin(email: string, password: string): Promise<{ user: AccountUser }> {
  return post<{ user: AccountUser }>('/api/auth/console/login', { email, password });
}

export interface SignupResult {
  user: AccountUser;
  bootstrap: boolean;
  pending_approval: boolean;
}

export function consoleSignup(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<SignupResult> {
  return post<SignupResult>('/api/auth/console/signup', input);
}

export function logout(): Promise<{ signed_out: true }> {
  return post<{ signed_out: true }>('/api/auth/logout');
}

export interface MeResult {
  user: AccountUser | null;
  accounts_durable: boolean;
}

export async function fetchMe(): Promise<MeResult> {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) return { user: null, accounts_durable: false };
  return (await response.json()) as MeResult;
}
