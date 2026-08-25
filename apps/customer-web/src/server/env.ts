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
 * Signs the QR the customer shows at the exit gate.
 *
 * Separate from the session secret on purpose. The two tokens have different lifetimes,
 * different audiences (a customer's browser vs. the store's exit terminal) and different
 * blast radii — rotating the session secret to invalidate live sessions should not
 * simultaneously invalidate every basket queued at the gate.
 */
export const EXIT_TOKEN_SIGNING_SECRET = requireSecret(
  'SNAPUP_EXIT_TOKEN_SECRET',
  'dev-only-exit-token-secret-never-use-in-production'
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
 * Signs the *account* session — who you are signed in as.
 *
 * A third signing secret rather than reusing the session one, on the same reasoning as
 * the exit token: rotating it should sign everybody out of their account without also
 * invalidating every shopping session live on a shop floor at that moment.
 *
 * ## These are two different sessions and only one of them expires
 *
 * The **account** session has no expiry by product decision: you stay signed in until you
 * tap Log out. That is safe because it grants identity and nothing else — it does not
 * unlock a catalogue or authorise a payment.
 *
 * The **shopping** session (`SESSION_TTL_SECONDS`, IP-bound) is the SDPA presence control
 * and keeps its 30-minute cap. Being signed in to your account while sitting at home
 * gets you a store directory and an order history, exactly as it should.
 */
export const ACCOUNT_SESSION_SECRET = requireSecret(
  'SNAPUP_ACCOUNT_SECRET',
  'dev-only-account-secret-never-use-in-production'
);

/**
 * Peppers the stored hash of a one-time code.
 *
 * Six digits is a million candidates, which a plain SHA-256 gives up instantly. The pepper
 * is what makes a leaked challenge row useless without also leaking this value — it is
 * held in the environment, never in the database.
 */
export const OTP_SHARED_PEPPER = requireSecret(
  'SNAPUP_OTP_PEPPER',
  'dev-only-otp-pepper-never-use-in-production'
);

/**
 * How one-time codes reach the customer.
 *
 * `log` writes the code to the server console, which is what makes the flow testable with
 * no SMS account. `sms` is the real path and currently throws, deliberately: a stub that
 * silently succeeded would make a broken pilot look like a working one.
 *
 * Defaults to `log` outside production and `sms` inside it, so shipping without setting
 * this fails loudly instead of quietly printing customers' codes into a shared log.
 */
export const OTP_DELIVERY: 'log' | 'sms' =
  (process.env.SNAPUP_OTP_DELIVERY as 'log' | 'sms' | undefined) ??
  (process.env.NODE_ENV === 'production' ? 'sms' : 'log');

/**
 * How a password-reset link reaches a console user. Same contract as `OTP_DELIVERY`:
 * `log` writes it to the server console, `email` is the real path and throws until a mail
 * provider is wired up.
 */
export const RESET_DELIVERY: 'log' | 'email' =
  (process.env.SNAPUP_RESET_DELIVERY as 'log' | 'email' | undefined) ??
  (process.env.NODE_ENV === 'production' ? 'email' : 'log');

/**
 * Origin the reset link points at — the **console**, not this API.
 *
 * They are different origins (`:3001` vs `:3000` locally), and a link to the wrong one
 * lands on a 404 after the user has already been told to check their email. Defaulting to
 * the local console keeps development working; a deployment must set it.
 */
export const RESET_LINK_BASE = (
  process.env.SNAPUP_CONSOLE_URL ?? 'http://localhost:3001'
).replace(/\/$/, '');

/**
 * How long an exit QR stays valid. Long enough to queue at the gate, short enough that a
 * screenshotted token is not a reusable pass out of the shop.
 */
export const EXIT_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * When set, the egress-IP presence check is bypassed and every request is treated as
 * originating from the store network. Loopback requests have no meaningful public IP,
 * so without this nothing is testable on a laptop. Ignored in production builds.
 */
export const PRESENCE_DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.SNAPUP_PRESENCE_DEV_BYPASS === '1';
