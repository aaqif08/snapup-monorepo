import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { productRepository } from '@/server/products';
import { getStore } from '@/server/stores';
import { orderRepository, priceOrder, toCustomerOrder } from '@/server/orders';
import type { OrderDraftLine } from '@/server/orders';
import { randomNonce } from '@/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates a server-priced order from the customer's basket.
 *
 * The contract is deliberately narrow: the client sends product ids and quantities and
 * nothing else. It does not send prices, a subtotal, a discount, a total or a weight —
 * every one of those is recomputed here from this store's catalogue. That is the whole
 * point. Until now the basket total, the exit-token weight and the UPI payment amount were
 * all produced by `useCartStore` in the browser, where anyone could edit them.
 *
 * The order is created `awaiting_payment`. No exit token is issued here, because at this
 * point nothing has been paid — see `orders/[id]/payment`.
 */
export async function POST(request: NextRequest) {
  const guard = await guardProductRequest(request);
  if (!guard.ok) return guard.response;

  let body: { lines?: unknown; client_claims_authenticated?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'malformed_request', 'Expected a JSON body.');
  }

  const parsed = parseLines(body.lines);
  if (!parsed.ok) return fail(400, 'malformed_request', parsed.message);

  const storeId = guard.session.sid;

  // Store-scoped from the signed session, never from the request body — the same rule the
  // barcode lookup follows. A client-supplied store id would let one store's basket be
  // priced against another store's catalogue.
  const catalogue = new Map(
    (await productRepository.listAllForStore(storeId))
      .filter((product) => product.is_active)
      .map((product) => [product.id, product])
  );

  const priced = priceOrder(parsed.lines, catalogue, {
    // Customer login is still mocked and client-side, so the server has no identity it can
    // verify and correctly withholds the 5% rather than granting it on a claim anyone can
    // forge in devtools. `discountReason` tells the UI which case it is in.
    verifiedCustomerId: null,
    clientClaimsAuthenticated: body.client_claims_authenticated === true,
  });

  if (!priced.ok) {
    const status = priced.failure.code === 'unknown_product' ? 409 : 400;
    return fail(status, priced.failure.code, priced.failure.message);
  }

  const store = await getStore(storeId);
  if (!store) return fail(403, 'unknown_store', 'This store is no longer available.');

  const order = await orderRepository.create({
    storeId,
    sessionId: guard.session.sub,
    status: 'awaiting_payment',
    lines: priced.order.lines,
    subtotalPaise: priced.order.subtotalPaise,
    discountPaise: priced.order.discountPaise,
    platformFeePaise: priced.order.platformFeePaise,
    totalPaise: priced.order.totalPaise,
    totalCostPaise: priced.order.totalCostPaise,
    expectedWeightGrams: priced.order.expectedWeightGrams,
    createdAt: Date.now(),
    paidAt: null,
    payment: {
      // Phase 1: the payee is this shop, not SnapUp. Null when the retailer has not
      // supplied a VPA yet, which the client reads as "counter payment only".
      payeeVpa: store.merchantVpa,
      payeeName: store.merchantDisplayName ?? store.name,
      transactionRef: `snapup${randomNonce(8).replace(/[^a-zA-Z0-9]/g, '')}`,
      confirmation: 'unconfirmed',
    },
  });

  return NextResponse.json(
    {
      order: toCustomerOrder(order),
      discount_reason: priced.order.discountReason,
    },
    { status: 201, headers: { 'cache-control': 'no-store' } }
  );
}

type ParsedLines = { ok: true; lines: OrderDraftLine[] } | { ok: false; message: string };

function parseLines(input: unknown): ParsedLines {
  if (!Array.isArray(input)) {
    return { ok: false, message: 'lines must be an array of { product_id, quantity }.' };
  }

  const lines: OrderDraftLine[] = [];
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, message: 'Each line must be an object.' };
    }
    const line = entry as Record<string, unknown>;
    if (typeof line.product_id !== 'string' || line.product_id.length === 0) {
      return { ok: false, message: 'Each line needs a product_id.' };
    }
    if (typeof line.quantity !== 'number') {
      return { ok: false, message: 'Each line needs a numeric quantity.' };
    }
    lines.push({ productId: line.product_id, quantity: line.quantity });
  }

  // Range and integrality of quantity are checked in priceOrder, so the rules live in one
  // place rather than being half-enforced at the edge and half in the pricing code.
  return { ok: true, lines };
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
