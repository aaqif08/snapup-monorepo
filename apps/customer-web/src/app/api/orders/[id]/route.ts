import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { orderRepository, toCustomerOrder } from '@/server/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One order, as its own customer may see it.
 *
 * This is how the phone learns that staff have approved the exit. The approval happens at
 * the desk, on a different device, and until this route existed nothing carried the news
 * back: the customer sat on the "show this code" screen with no way to know the bill had
 * been released. The checkout screen polls this while it waits, and moves to the bill the
 * moment `exit.approved_at` is set.
 *
 * Scoped to the calling session inside the repository, so an order id copied from someone
 * else's screen resolves to nothing rather than to their basket. `session.sid` is routing
 * only — which branch holds the record — and comes from the signed token.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const order = await orderRepository.findForSession(guard.session.sub, id, guard.session.sid);
  if (!order) {
    return NextResponse.json(
      { error: { code: 'order_not_found', message: 'This order does not exist.' } },
      { status: 404, headers: NO_STORE }
    );
  }

  return NextResponse.json({ order: toCustomerOrder(order) }, { status: 200, headers: NO_STORE });
}

const NO_STORE = { 'cache-control': 'no-store' };
