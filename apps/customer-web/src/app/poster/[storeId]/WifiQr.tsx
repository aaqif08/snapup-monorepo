'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * The "join the Wi-Fi" half of the poster.
 *
 * ## Why the password is typed here rather than stored
 *
 * A Wi-Fi QR contains the password in plain text — that is the whole format. Storing it
 * to render this page would mean the shop's Wi-Fi password sitting in the database, in
 * backups and in whatever log recorded the response, in order to produce a poster that is
 * then printed once and stuck to a wall. The password never leaves this browser: it is
 * typed, encoded into the QR by client-side JavaScript, printed, and forgotten when the
 * tab closes.
 *
 * The field is hidden when printing, so the printed sheet carries the code without also
 * carrying the password in readable text next to it.
 */
export default function WifiQr({ ssid }: { ssid: string }) {
  const [password, setPassword] = useState('');

  // The WIFI: URI scheme every modern phone camera understands. Backslash, semicolon,
  // comma, colon and double-quote are separators in this format and must be escaped, or a
  // password containing one silently produces a QR that joins nothing.
  const escape = (value: string) => value.replace(/([\;,:"])/g, '\$1');
  const payload = `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;`;

  return (
    <div className="text-center">
      <div className="mx-auto flex h-[240px] w-[240px] items-center justify-center rounded-2xl border-4 border-black bg-white p-3">
        {password ? (
          <QRCodeSVG value={payload} size={200} level="M" />
        ) : (
          <p className="px-4 text-sm font-bold text-neutral-400">
            Enter the Wi-Fi password to generate this code
          </p>
        )}
      </div>

      <div className="print:hidden">
        <label className="mt-4 block text-xs font-extrabold uppercase tracking-wide text-neutral-500">
          Wi-Fi password for {ssid}
        </label>
        <input
          type="text"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Typed here only — never sent or saved"
          className="mt-1 w-full rounded-xl border-2 border-neutral-300 px-3 py-2 text-center text-sm"
        />
      </div>
    </div>
  );
}
