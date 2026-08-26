import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

/**
 * The branch credential vault.
 *
 * ## Why this exists
 *
 * `apiKeyRef` holds the *name* of an environment variable, never a key, and that is the
 * right shape for a deployment someone operates with a terminal. It is the wrong shape for
 * a pilot: setting a branch's key means editing the hosting environment and redeploying,
 * which the person running the shop cannot do. The console needs a field they can paste
 * into.
 *
 * A pasted key must not become a readable key. Store records are returned by the admin
 * API, rendered in a browser, written to a table that gets backed up, and read by whoever
 * can open that backup — a plaintext credential in that path is a leaked credential. So
 * the key is encrypted before it is stored and is never decrypted for display, only for
 * use. What the console gets back is a mask and a fingerprint, which answers "is a key
 * set" and "is it the same one I pasted" without carrying the secret.
 *
 * ## The encryption
 *
 * AES-256-GCM. Authenticated, so a ciphertext edited in the database fails to open rather
 * than decrypting to something else. The key is derived from `SNAPUP_CREDENTIAL_SECRET`
 * with scrypt and a per-record salt, and every field needed to reverse it — salt, IV, tag
 * — travels with the ciphertext. That means rotating the encryption secret invalidates
 * stored keys rather than silently producing garbage: they fail to open, loudly, and are
 * re-pasted.
 *
 * This protects a credential at rest and in transit through the admin surface. It does not
 * protect against someone who already has both the database and the deployment's
 * environment — nothing at this layer can, and claiming otherwise would be worse than not
 * encrypting at all.
 */

const VERSION = 'v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function secret(): string {
  const value = process.env.SNAPUP_CREDENTIAL_SECRET;
  if (value && value.length >= 16) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SNAPUP_CREDENTIAL_SECRET is not set (or is shorter than 16 characters). Refusing ' +
        'to encrypt branch credentials with a default secret in production.'
    );
  }
  return 'dev-only-credential-secret-never-use-in-production';
}

/**
 * A stable, non-reversible handle for a key.
 *
 * Lets the console say "this is the same key you pasted last week" without holding the
 * key. Truncated to 12 hex characters: long enough that two different keys colliding is
 * not a practical concern for a fleet of shops, short enough to read aloud on a call.
 */
export function fingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex').slice(0, 12);
}

/**
 * What the console may see: enough to recognise a key, never enough to use one.
 *
 * Keys shorter than 12 characters are masked entirely. Revealing the last four of an
 * eight-character key gives away half of it, and a key that short is a bad key whose
 * details are not worth leaking on top.
 */
export function maskKey(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length < 12) return '•'.repeat(8);
  return `${'•'.repeat(8)}${trimmed.slice(-4)}`;
}

export interface SealedCredential {
  /** `v1:salt:iv:tag:ciphertext`, all base64url. Opaque to every caller but `open`. */
  sealed: string;
  masked: string;
  fingerprint: string;
}

/** Encrypts a pasted key for storage. Returns everything the record needs. */
export function seal(plaintext: string): SealedCredential {
  const trimmed = plaintext.trim();
  if (!trimmed) throw new Error('Refusing to seal an empty credential.');

  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = scryptSync(secret(), salt, KEY_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const parts = [VERSION, salt, iv, tag, ciphertext].map((part) =>
    typeof part === 'string' ? part : part.toString('base64url')
  );

  return {
    sealed: parts.join(':'),
    masked: maskKey(trimmed),
    fingerprint: fingerprint(trimmed),
  };
}

/**
 * Decrypts a stored key for use against the retailer's API.
 *
 * Returns null rather than throwing on anything malformed, because the caller's fallback —
 * the environment-variable key, then the platform key — is a better outcome than a request
 * that dies. A key that cannot be opened is logged as a warning, since the branch will
 * behave as though it has no key at all and that is worth knowing before someone reports
 * it as an outage.
 */
export function open(sealed: string | null): string | null {
  if (!sealed) return null;

  const parts = sealed.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    console.warn('[credentials] Stored credential is malformed or of an unknown version.');
    return null;
  }

  try {
    const [, saltPart, ivPart, tagPart, dataPart] = parts;
    const key = scryptSync(secret(), Buffer.from(saltPart, 'base64url'), KEY_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Authentication failure. Either the ciphertext was tampered with, or
    // SNAPUP_CREDENTIAL_SECRET has changed since it was written. Both mean the key must be
    // pasted again; neither should take the branch down with an exception.
    console.warn(
      '[credentials] Stored credential could not be decrypted. It was written with a ' +
        'different SNAPUP_CREDENTIAL_SECRET, or has been altered. Re-enter it in the console.'
    );
    return null;
  }
}

/** Constant-time comparison, for checking a submitted key against a stored fingerprint. */
export function fingerprintMatches(plaintext: string, expected: string): boolean {
  const actual = Buffer.from(fingerprint(plaintext), 'utf8');
  const target = Buffer.from(expected, 'utf8');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

/**
 * Turns whatever the console sent into the four columns a record stores.
 *
 * The three-way distinction is the point, and it is why `apiKey` is optional rather than
 * nullable-only:
 *
 *   `undefined` — the form did not touch the field. Keep the stored key. This is the
 *                 common case, and getting it wrong means every unrelated edit to a
 *                 branch silently wipes its credential.
 *   `null`/`''` — the operator cleared it. Forget the key.
 *   a string    — a new key. Seal it.
 */
export function credentialFieldsFor(
  apiKey: string | null | undefined,
  existing?: {
    apiKeySealed: string | null;
    apiKeyMasked: string | null;
    apiKeyFingerprint: string | null;
    apiKeySetAt: number | null;
  }
): {
  apiKeySealed: string | null;
  apiKeyMasked: string | null;
  apiKeyFingerprint: string | null;
  apiKeySetAt: number | null;
} {
  if (apiKey === undefined) {
    return (
      existing ?? {
        apiKeySealed: null,
        apiKeyMasked: null,
        apiKeyFingerprint: null,
        apiKeySetAt: null,
      }
    );
  }

  const trimmed = (apiKey ?? '').trim();
  if (!trimmed) {
    return {
      apiKeySealed: null,
      apiKeyMasked: null,
      apiKeyFingerprint: null,
      apiKeySetAt: null,
    };
  }

  const { sealed, masked, fingerprint: fp } = seal(trimmed);
  return {
    apiKeySealed: sealed,
    apiKeyMasked: masked,
    apiKeyFingerprint: fp,
    apiKeySetAt: Date.now(),
  };
}
