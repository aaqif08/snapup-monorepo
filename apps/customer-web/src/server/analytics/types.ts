import 'server-only';

/**
 * The store event log — the single source every analytics number is derived from.
 *
 * Nothing in the system was recording behaviour before this. Scans lived in the browser's
 * zustand store, sessions were stateless signed tokens with no server-side row, and there
 * were no orders at all. So "use the data you're already collecting" was not yet true: the
 * signals passed *through* the server (a barcode lookup is an authenticated request, a
 * session start is a POST) but nothing persisted them. This log is where they land.
 *
 * Design notes that matter for the pilot:
 *
 * - Events are append-only and immutable. Analytics is a read model over them, never a set
 *   of counters mutated in place — a counter that drifts cannot be reconciled, an event log
 *   can always be re-aggregated when a metric definition changes.
 * - Every event carries `storeId`, because a store owner must only ever see their own
 *   store's numbers. That scoping is enforced at query time, not by convention.
 * - `sessionId` is the shopping session, which is already anonymous: it is a random
 *   `sess_*` id bound to an egress IP, never a customer identity. Aggregates are computed
 *   over these, so the dashboard reports behaviour without profiling individuals.
 */
export type StoreEventKind =
  /** A presence-verified shopping session was minted at the entrance. */
  | 'session_started'
  /** Session ended explicitly — customer tapped finish, or checkout completed. */
  | 'session_ended'
  /** A barcode lookup resolved to a product in this store's catalogue. */
  | 'product_scanned'
  /** A barcode lookup found nothing. These are catalogue gaps, and they are worth money. */
  | 'scan_missed'
  /** A server-priced order was created. Carries the money. */
  | 'order_placed';

/**
 * A priced line, denormalised onto the `order_placed` event.
 *
 * Copied rather than referenced on purpose: an event records what was true when it
 * happened. If the operator re-prices an item next week, last week's revenue must not move
 * — which it would if the read model joined back to the live product row.
 */
export interface OrderEventLine {
  productId: string;
  name: string;
  quantity: number;
  /** Paise, quantity included. */
  linePaise: number;
}

export interface StoreEvent {
  id: string;
  storeId: string;
  /** Anonymous shopping-session id. Never a customer identity. */
  sessionId: string;
  kind: StoreEventKind;
  /** Epoch milliseconds, server clock. */
  occurredAt: number;

  // ---- Present on product_scanned ----
  productId?: string;
  productName?: string;
  /**
   * Physical aisle, when the operator has mapped one; falls back to the product's
   * category. A scan is a genuine location signal — the customer was holding that item,
   * so they were standing where it is shelved.
   */
  aisle?: string;

  // ---- Present on scan_missed ----
  barcode?: string;

  // ---- Present on order_placed ----
  orderId?: string;
  /** Paise. Integer arithmetic throughout — see the note in useCartStore. */
  grossPaise?: number;
  /**
   * Snap Up's own take on this order, in paise.
   *
   * Recorded per order rather than derived from a constant, because the fee is a
   * percentage of the basket and is waived entirely for a signed-in customer. Multiplying
   * an order count by a flat figure — which is what this replaced — overstated the take
   * by the whole of every member's waiver.
   */
  feePaise?: number;
  costPaise?: number;
  itemCount?: number;
  /** Seconds between the session's start and the order. */
  shoppingSeconds?: number;
  lines?: OrderEventLine[];
}

export interface EventQuery {
  storeId: string;
  /** Inclusive lower bound, epoch ms. */
  fromMs: number;
  /** Exclusive upper bound, epoch ms. */
  toMs: number;
}

export interface AnalyticsRepository {
  record(event: Omit<StoreEvent, 'id'>): Promise<void>;
  /** Ordered by `occurredAt` ascending, so duration maths can stream in one pass. */
  query(query: EventQuery): Promise<StoreEvent[]>;
  /** Oldest event still retained, for honest "data since" labelling on the dashboard. */
  earliestEventAt(storeId: string): Promise<number | null>;
}
