import { notFound } from 'next/navigation';
import { getStore } from '@/server/stores';
import { issueEntryQr, storeIdForPosterCode } from '@/server/qr';
import PosterEntry from './PosterEntry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What a printed poster's second code opens.
 *
 * The URL carries an eight-character store pointer, not a credential. The entry token is
 * minted **here, when the code is scanned**, with the ordinary two-minute lifetime — so the
 * printed sheet is no longer a permanent entry credential, and the property that made the
 * rotating display code worth having is back: a photograph of this poster is a photograph
 * of a store id, and the token it produces is dead two minutes after someone stands in the
 * shop and scans it.
 *
 * The store network check still runs on the session request, unchanged. This page cannot
 * grant anything on its own; it only saves the shopper from having to aim a camera at a
 * screen that may not exist.
 */
export default async function PosterEntryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const storeId = await storeIdForPosterCode(code);
  if (!storeId) notFound();

  const store = await getStore(storeId);
  if (!store || !store.isActive) notFound();

  const { token } = issueEntryQr(store.id);

  return <PosterEntry token={token} storeName={store.name} ssid={store.advertisedSsid} />;
}
