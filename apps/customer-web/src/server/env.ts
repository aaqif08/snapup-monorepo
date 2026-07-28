import 'server-only';

/**
 * Secrets are read once at module load. In production a missing secret is fatal:
 * falling back to a known dev value would make every signature in the system
 * forgeable by anyone who has read this repo.
 */
function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is not set. Refusing to start with a default signing secret in production.`
    );
  }
  return devFallback;
}

export const QR_SIGNING_SECRET = requireSecret(
  'SNAPUP_QR_SECRET',
  'dev-only-qr-secret-never-use-in-production'
);

export const SESSION_SIGNING_SECRET = requireSecret(
  'SNAPUP_SESSION_SECRET',
  'dev-only-session-secret-never-use-in-production'
);

/**
 * Shared secret the admin console presents when writing to the store registry.
 *
 * Held only by the admin app's *server*, never shipped to its browser bundle — a token in
 * client JavaScript is a token anyone can read and replay, which would make the whole
 * write API public.
 */
export const ADMIN_API_TOKEN = requireSecret(
  'SNAPUP_ADMIN_API_TOKEN',
  'dev-only-admin-token-never-use-in-production'
);

/**
 * Entrance QR codes are short-lived so a photographed QR is useless within minutes.
 * This is the first half of the SDPA replay defence; the egress-IP check is the second.
 */
export const QR_TTL_SECONDS = 120;

/** CTO requirement 1: shopping sessions are capped at 30 minutes. */
export const SESSION_TTL_SECONDS = 30 * 60;

/**
 * When set, the egress-IP presence check is bypassed and every request is treated as
 * originating from the store network. Loopback requests have no meaningful public IP,
 * so without this nothing is testable on a laptop. Ignored in production builds.
 */
export const PRESENCE_DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.SNAPUP_PRESENCE_DEV_BYPASS === '1';
