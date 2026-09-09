import { notFound } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { getStore } from '@/server/stores';
import { issuePosterQr } from '@/server/qr';
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
 * The session code is a signed poster token rather than a store id, so the printed sheet
 * cannot be edited to point at another shop. Its weakness is duration rather than
 * forgeability — see `issuePosterQr`. A shop with a screen at the door should use
 * `/entrance/[storeId]`, which rotates every two minutes and keeps both presence factors.
 */
export default async function PosterPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;

  const store = await getStore(storeId);
  if (!store || !store.isActive) notFound();

  const { token } = issuePosterQr(store.id);

  // Absolute, because this is printed: a relative path is meaningless once the code leaves
  // the browser that rendered it. NEXT_PUBLIC_APP_URL lets a custom domain be printed
  // instead of the deployment hostname once DNS is cut over.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const link = `${base}/enter?p=${encodeURIComponent(token)}`;

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

      <p className="mt-8 text-center text-[11px] text-neutral-400 print:hidden">
        Store {store.id} · printed code valid for two years · press Ctrl/Cmd+P to print
      </p>
    </main>
  );
}
