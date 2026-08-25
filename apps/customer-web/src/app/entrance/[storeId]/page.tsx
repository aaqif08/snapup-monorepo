'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * The entrance display.
 *
 * This is the screen a shop puts on a tablet or a monitor by the door, and until now it
 * did not exist — the customer app told shoppers to scan an entrance code that nothing in
 * the system produced. `/api/store/[id]/entry-qr` minted the token; nobody rendered it.
 *
 * The token is signed and short-lived, and the endpoint says how long it has. Rotating
 * matters: a code that never changed could be photographed once and used from the car
 * park, which would leave the store-network check as the only presence factor rather than
 * one of two. The refresh runs slightly ahead of the stated lifetime so the code on the
 * wall is never the one that just expired.
 *
 * Not a customer-facing route in the usual sense, so it carries no chrome — a shop display
 * with a bottom navigation bar on it would be an invitation to press something.
 */
export default function EntranceDisplayPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);

  const [token, setToken] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async (): Promise<number> => {
    try {
      const response = await fetch(`/api/store/${encodeURIComponent(storeId)}/entry-qr`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? `The store registry returned ${response.status}.`);
        // Back off rather than hammering a failing endpoint from a display nobody watches.
        return 30;
      }

      const body = await response.json();
      setToken(body.qr_token);
      setStoreName(body.store?.name ?? null);
      setRefreshedAt(Date.now());
      setError(null);

      // Refresh a little before the server's own deadline; a display showing an expired
      // code is worse than one that flickers.
      const seconds = Number(body.rotate_after_seconds);
      return Number.isFinite(seconds) && seconds > 5 ? seconds - 5 : 55;
    } catch {
      setError('Could not reach the store registry.');
      return 30;
    }
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const cycle = async () => {
      const nextIn = await load();
      if (cancelled) return;
      timer = setTimeout(cycle, nextIn * 1000);
    };
    void cycle();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-10">
      <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted">Snap Up</p>
      <h1 className="mt-2 max-w-xl text-center text-3xl font-extrabold leading-tight text-ink">
        {storeName ?? 'Entrance code'}
      </h1>

      {/* Always white behind the code regardless of theme — a dark-mode QR is a QR that
          does not scan. */}
      <div className="mt-8 rounded-3xl bg-white p-6 shadow-pop">
        {token ? (
          <QRCodeSVG value={token} size={280} level="M" />
        ) : (
          <div className="flex h-[280px] w-[280px] items-center justify-center">
            <p className="text-sm font-bold text-neutral-500">
              {error ? 'Unavailable' : 'Preparing…'}
            </p>
          </div>
        )}
      </div>

      <p className="mt-8 max-w-sm text-center text-base leading-relaxed text-muted">
        Open Snap Up and scan this code to start shopping. Make sure you are connected to
        the store Wi-Fi.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-4 py-2 text-sm font-bold text-danger">
          {error}
        </p>
      ) : (
        refreshedAt && (
          <p className="mt-4 text-xs font-semibold text-muted">
            Code refreshes automatically · last updated{' '}
            {new Date(refreshedAt).toLocaleTimeString()}
          </p>
        )
      )}
    </div>
  );
}
