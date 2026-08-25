import 'server-only';

/**
 * `owner@kurinji.in` -> `o****@kurinji.in`.
 *
 * Used where an address is echoed back to a caller who has not proved they own it — the
 * "if that address has an account, we've sent a link" screen. The domain survives because
 * it is what lets someone spot that they typed a work address instead of a personal one;
 * the local part does not, because that is the half that identifies a person.
 */
export function maskEmail(email: string | null): string {
  if (!email) return 'unknown';

  const at = email.lastIndexOf('@');
  if (at <= 0) return '****';

  const local = email.slice(0, at);
  const domain = email.slice(at);

  if (local.length <= 1) return `*${domain}`;
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}${domain}`;
}
