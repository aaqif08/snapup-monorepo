import { NextResponse, type NextRequest } from 'next/server';
import { readAccount } from '@/server/accounts/session';
import { orderRepository } from '@/server/orders';
import { getStore } from '@/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in customer's own bills.
 *
 * Guarded by the **account** cookie, not the shopping session: a bill outlives the visit
 * that produced it, and the whole point of My Bills is reading it from the sofa a week
 * later. The user id comes from the signed cookie and never from a parameter, so there is
 * no id to tamper with and no way to ask for somebody else's history.
 *
 * A guest gets an empty list rather than a 401. Not being signed in is an ordinary state
 * for this app, and the screen has a perfectly good thing to say about it.
 */
export async function GET(request: NextRequest) {
  const account = await readAccount(request);
  if (!account.ok) {
    return NextResponse.json(
      { bills: [], signed_in: false },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  }

  const orders = await orderRepository.listForUser(account.user.id, 50);

  // One store lookup per distinct store rather than per order: a regular at one shop would
  // otherwise trigger fifty identical reads to render one list.
  const storeNames = new Map<string, string>();
  for (const storeId of new Set(orders.map((order) => order.storeId))) {
    const store = await getStore(storeId);
    storeNames.set(storeId, store?.name ?? storeId);
  }

  return NextResponse.json(
    {
      signed_in: true,
      bills: orders.map((order) => ({
        id: order.id,
        store_id: order.storeId,
        store_name: storeNames.get(order.storeId) ?? order.storeId,
        status: order.status,
        confirmation: order.payment.confirmation,
        total_paise: order.totalPaise,
        subtotal_paise: order.subtotalPaise,
        discount_paise: order.discountPaise,
        platform_fee_paise: order.platformFeePaise,
        items: order.lines.reduce((total, line) => total + line.quantity, 0),
        lines: order.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit_price_paise: line.unitPricePaise,
          line_paise: line.linePaise,
        })),
        transaction_ref: order.payment.transactionRef,
        created_at: order.createdAt,
        paid_at: order.paidAt,
      })),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
