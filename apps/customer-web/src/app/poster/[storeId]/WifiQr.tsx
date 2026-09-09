'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

type Security = 'WPA' | 'nopass' | 'WEP';

/**
 * The "join the Wi-Fi" half of the poster.
 *
 * ## Why the password is typed here rather than stored
 *
 * A Wi-Fi QR contains the password in plain text — that is the whole format. Storing it to
 * render this page would mean the shop's Wi-Fi password sitting in the database, in backups
 * and in whatever log recorded the response, in order to produce a poster that is printed
 * once and stuck to a wall. The password never leaves this browser: typed, encoded by
 * client-side JavaScript, printed, forgotten when the tab closes.
 *
 * ## The escaping is not optional
 *
 * `\`, `;`, `,`, `:` and `"` are separators in the `WIFI:` grammar. A password containing
 * any of them produces a QR that parses into the wrong fields and fails to join with no
 * useful message — the phone simply says it could not connect. The backslash has to be
 * escaped first, or escaping the others would then double-escape their new backslashes.
 */
export default function WifiQr({ ssid }: { ssid: string }) {
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState<Security>('WPA');
  const [hidden, setHidden] = useState(false);

  const escape = (value: string) =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/([;,:"])/g, '\\$1');

  const payload =
    security === 'nopass'
      ? `WIFI:T:nopass;S:${escape(ssid)};${hidden ? 'H:true;' : ''};`
      : `WIFI:T:${security};S:${escape(ssid)};P:${escape(password)};${hidden ? 'H:true;' : ''};`;

  const ready = security === 'nopass' || password.length > 0;

  return (
    <div className="text-center">
      <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-2xl border-2 border-neutral-300 bg-white p-2">
        {ready ? (
          <QRCodeSVG value={payload} size={224} level="M" marginSize={4} />
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
          disabled={security === 'nopass'}
          placeholder="Typed here only — never sent or saved"
          className="mt-1 w-full rounded-xl border-2 border-neutral-300 px-3 py-2 text-center text-sm disabled:bg-neutral-100"
        />

        <div className="mt-2 flex items-center justify-center gap-3 text-xs">
          <select
            value={security}
            onChange={(event) => setSecurity(event.target.value as Security)}
            className="rounded-lg border-2 border-neutral-300 px-2 py-1"
          >
            <option value="WPA">WPA / WPA2 / WPA3</option>
            <option value="WEP">WEP (old)</option>
            <option value="nopass">Open — no password</option>
          </select>
          <label className="flex items-center gap-1 font-semibold text-neutral-600">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => setHidden(event.target.checked)}
            />
            Hidden network
          </label>
        </div>

        <p className="mt-2 text-[11px] leading-snug text-neutral-500">
          If the phone says it cannot connect, the password is wrong or the network is
          hidden — tick the box above and reprint.
        </p>
      </div>
    </div>
  );
}
