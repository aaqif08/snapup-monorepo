/**
 * What a camera just read at the entrance, and what to do about it.
 *
 * ## Why this is shared rather than inlined
 *
 * There are two scanners. `/enter` is the dedicated entry gate; `/scan` is the screen the
 * bottom navigation actually leads to, which reads entrance codes when there is no session
 * and product barcodes when there is. They were written at different times and only one of
 * them learned about printed posters — so a poster scanned from the tab customers actually
 * use was posted to the server as though it were a token, and came back "This entrance code
 * is not valid". Both now classify through this function, so a new code format cannot be
 * taught to one scanner and not the other.
 */

export type ScannedEntry =
  /** A `WIFI:` join code. Nothing in a web page can act on it — the OS handles these. */
  | { kind: 'wifi' }
  /** A printed poster's short store pointer; `/p/<code>` mints a fresh entry token. */
  | { kind: 'poster'; code: string }
  /** A signed entry token, from a rotating display or an older printed poster. */
  | { kind: 'token'; token: string };

/** Eight characters from Crockford's alphabet, as `posterCodeFor` emits. */
const POSTER_CODE = /^[0-9A-Za-z]{8}$/;

export function classifyScannedEntry(scanned: string): ScannedEntry {
  const text = scanned.trim();

  if (/^WIFI:/i.test(text)) return { kind: 'wifi' };

  // A printed poster carries a URL, because a phone camera can open a link and cannot open
  // a bare token. Scanned by an in-app camera it arrives as the URL text.
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);

      const poster = url.pathname.match(/^\/p\/([0-9A-Za-z]{8})$/);
      if (poster) return { kind: 'poster', code: poster[1] };

      // Posters printed before short codes existed put the whole signed token in `?p=`.
      // Those sheets are on walls and stay valid, so they keep working.
      const legacy = url.searchParams.get('p');
      if (legacy) return { kind: 'token', token: legacy };
    } catch {
      // Not a URL we understand; fall through and let the server judge the raw text.
    }
  }

  // Someone typing the code from under the poster's QR, rather than scanning it.
  // A signed token always contains a '.', so it cannot collide with this.
  if (POSTER_CODE.test(text)) return { kind: 'poster', code: text.toUpperCase() };

  return { kind: 'token', token: text };
}

/** Shown when a `WIFI:` code is presented to a scanner that cannot act on it. */
export const WIFI_CODE_MESSAGE =
  'That is the Wi-Fi code. Scan it with your phone’s own camera app to join the shop ' +
  'network, then come back and scan the second code.';
