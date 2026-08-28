import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Sign in with Google, for the business console.
 *
 * ## Why the authorization-code flow and not the one-tap credential
 *
 * Google's JavaScript button hands the browser an ID token, which is quicker to build and
 * puts the browser between us and the identity provider. This uses the redirect flow
 * instead: the code is exchanged for tokens **server to server**, using a client secret the
 * browser never sees, and the resulting session cookie is minted by us. Nothing the page
 * can edit decides who is signed in.
 *
 * ## Unconfigured is a supported state
 *
 * A deployment without Google credentials must not show a button that fails. `isConfigured`
 * gates the button, the start route and the callback alike — so the feature is absent
 * rather than broken, which is the difference between "we do not offer that" and "this
 * product is faulty".
 *
 * ## What Google is trusted for
 *
 * The email address, and only once Google says it is verified. `email_verified` is checked
 * because an unverified address would let someone create a Google account claiming an email
 * they do not control and inherit a SnapUp account keyed to it. Google is not trusted to
 * decide anyone's *role*: a person arriving here becomes whatever the account rules make
 * them, exactly as a password signup would.
 */

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Ten minutes: long enough to sign in and pick an account, short enough to be useless later. */
const STATE_TTL_SECONDS = 600;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  // Must match an authorised redirect URI on the Google Cloud OAuth client exactly,
  // including scheme and port. Google compares it as a string, not as a URL.
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? '';

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isConfigured(): boolean {
  return googleConfig() !== null;
}

function stateSecret(): string {
  return process.env.SNAPUP_ACCOUNT_SECRET ?? 'dev-only-account-secret-never-use-in-production';
}

/**
 * A signed, self-expiring `state` value.
 *
 * CSRF protection for the redirect: without it an attacker can send a victim's browser to
 * our callback carrying the attacker's authorization code, and the victim ends up signed
 * into the attacker's account. Signed rather than stored, so it needs no server-side
 * session table and survives the serverless fan-out this may be deployed on — the
 * signature is what makes it unforgeable, and the timestamp is what stops it being replayed
 * a week later.
 *
 * `next` rides along so the callback can return the person to where they started.
 */
export function issueState(next: string): string {
  const payload = JSON.stringify({
    n: randomBytes(12).toString('base64url'),
    t: Math.floor(Date.now() / 1000),
    // Only ever a path on this origin. An absolute URL here would turn the callback into
    // an open redirect, which is a phishing primitive handed out for free.
    next: next.startsWith('/') && !next.startsWith('//') ? next : '/',
  });
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return body + '.' + signature;
}

export function verifyState(state: string): { valid: true; next: string } | { valid: false } {
  const [body, signature] = state.split('.');
  if (!body || !signature) return { valid: false };

  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false };

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      t: number;
      next: string;
    };
    if (Math.floor(Date.now() / 1000) - parsed.t > STATE_TTL_SECONDS) return { valid: false };
    return { valid: true, next: parsed.next ?? '/' };
  } catch {
    return { valid: false };
  }
}

export function authorizationUrl(config: GoogleConfig, state: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  // Forces the account chooser. Without it a shared till silently reuses whoever signed in
  // last, which in a shop is the wrong default by a wide margin.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
  googleId: string;
}

interface IdTokenClaims {
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub?: string;
}

function decodeIdTokenClaims(idToken: string): IdTokenClaims | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Exchange the authorization code for an identity.
 *
 * The ID token's signature is deliberately **not** verified here, and that is safe for one
 * specific reason: it arrives in the body of a direct TLS response from Google's token
 * endpoint, authenticated by our client secret, rather than by way of the browser. There is
 * no untrusted party in that path who could forge it.
 *
 * An ID token accepted from anywhere else — a header, a form post, the client — would have
 * to be verified against Google's JWKS first. This function must not be reused for that.
 */
export async function exchangeCode(
  config: GoogleConfig,
  code: string
): Promise<GoogleIdentity | null> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as { id_token?: string } | null;
  if (!body?.id_token) return null;

  const claims = decodeIdTokenClaims(body.id_token);
  if (!claims?.email || !claims.sub) return null;

  // An unverified address is not evidence of anything. Accepting it would let someone
  // register a Google account asserting an email they do not control and take over the
  // SnapUp account keyed to it.
  if (claims.email_verified === false) return null;

  return {
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
    googleId: claims.sub,
  };
}
