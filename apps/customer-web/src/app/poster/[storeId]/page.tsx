import { notFound } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { getStore } from '@/server/stores';
import { posterCodeFor } from '@/server/qr';
import WifiQr from './WifiQr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The printable entrance poster.
 *
 * Two codes, because one cannot do both jobs. A Wi-Fi QR carries a `WIFI:` URI that the
 * phone's camera hands to the operating system's network settings; a session QR carries an
 * https link the camera hands to the browser. There is no payload that is both, so a poster
 * promising "scan to join and start" has to show two squares and say which is which.
 *
 * Order matters and is not cosmetic: joining the network has to happen first. The session
 * link fails with "connect to the store Wi-Fi" if it is scanned while the phone is still on
 * mobile data, and a shopper who scans right-to-left will meet that error before they have
 * done anything wrong.
 *
 * The session code is an eight-character store pointer, not a credential: `/p/[code]` mints
 * a fresh two-minute entry token when it is scanned. So the printed sheet is not a
 * permanent key, and it is short — the first version printed the whole signed token, 240
 * characters, which is a 61x61 QR that cameras could not read off the page.
 *
 * The code is an HMAC of the store id, so it cannot be guessed for a shop whose poster you
 * have not seen, and the printed sheet cannot be edited to point somewhere else.
 */
export default async function PosterPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;

  const store = await getStore(storeId);
  if (!store || !store.isActive) notFound();

  // Absolute, because this is printed: a relative path is meaningless once the code leaves
  // the browser that rendered it. NEXT_PUBLIC_APP_URL lets a custom domain be printed
  // instead of the deployment hostname once DNS is cut over.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const code = posterCodeFor(store.id);
  const link = `${base}/p/${code}`;

  return (
    <main className="mx-auto max-w-[820px] bg-white px-10 py-12 text-black">
      <header className="text-center">
        <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-neutral-500">
          Snap Up — scan &amp; pay
        </p>
        <h1 className="mt-2 text-4xl font-black leading-tight">{store.name}</h1>
        <p className="mt-3 text-lg font-semibold text-neutral-600">
          Two steps. Join the Wi-Fi, then start shopping.
        </p>
        <p className="mt-3 inline-block rounded-full bg-black px-5 py-2 text-sm font-extrabold text-white">
          Use your phone’s own camera app — not the Snap Up scanner
        </p>
      </header>

      <div className="mt-10 grid grid-cols-2 gap-8">
        <section className="rounded-3xl border-2 border-neutral-200 p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-lg font-black text-white">
              1
            </span>
            <h2 className="text-xl font-extrabold">Join the Wi-Fi</h2>
          </div>
          <WifiQr ssid={store.advertisedSsid} />
          <p className="mt-4 text-center text-sm font-semibold text-neutral-600">
            Network: <span className="font-mono font-bold">{store.advertisedSsid}</span>
          </p>
        </section>

        <section className="rounded-3xl border-2 border-neutral-200 p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-lg font-black text-white">
              2
            </span>
            <h2 className="text-xl font-extrabold">Start shopping</h2>
          </div>
          <div className="mx-auto flex h-[240px] w-[240px] items-center justify-center rounded-2xl border-4 border-black bg-white p-3">
            <QRCodeSVG value={link} size={200} level="M" />
          </div>
          <p className="mt-4 text-center text-sm font-semibold text-neutral-600">
            Opens Snap Up and starts your session
          </p>
          <p className="mt-1 text-center text-xs text-neutral-500">
            Or open snapup and enter code <span className="font-mono font-bold">{code}</span>
          </p>
        </section>
      </div>

      <footer className="mt-10 rounded-3xl bg-neutral-100 p-6 text-center">
        <p className="text-base font-bold">
          Scan code 1 first. The second code only works once you are on{' '}
          <span className="font-mono">{store.advertisedSsid}</span> inside the shop.
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Need help? Ask a member of staff at the counter.
        </p>
      </footer>

      {/* Hidden from the printed sheet. On screen it lets whoever is setting the poster up
          confirm the link actually works from a phone before committing it to paper, and
          makes a relative URL — the symptom of an unset NEXT_PUBLIC_APP_URL — visible
          rather than silently baked into a QR nobody can read by eye. */}
      <div className="mt-8 text-center print:hidden">
        <p className="text-[11px] text-neutral-400">
          Store {store.id} · printed code valid for two years · press Ctrl/Cmd+P to print
        </p>
        <p className="mt-2 break-all text-[11px] text-neutral-400">
          Session link: <span className="font-mono">{link}</span>
        </p>
        <p className="mt-1 text-[11px] text-neutral-400">
          Test both codes with a phone before printing.
        </p>
      </div>
    </main>
  );
}
