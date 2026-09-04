import 'server-only';
import type { InternalProduct, ProductDraft } from '../products/types';
import { NO_STATED_HOURS, NO_STORED_API_KEY } from '../stores/types';
import type { StoreDraft, StoreRecord } from '../stores/types';
import { NO_WEIGHT_CHECK } from '../orders/types';
import type { OrderRecord, PaymentConfirmation } from '../orders/types';
import type { StoreEvent } from '../analytics/types';

/**
 * ============================================================================
 * THE ONLY FILE THAT ASSUMES ANYTHING ABOUT THE RETAILER'S API.
 * ============================================================================
 *
 * Every path and every field name below is an **assumption**, written against a
 * conventional REST shape because their specification was not available when this was
 * built. None of it has been run against their system.
 *
 * It is isolated here on purpose. The repositories that use it contain the domain rules —
 * pagination clamping, store scoping, payment idempotency, the projection boundary — and
 * none of those rules change when the upstream contract turns out to differ. Reconciling
 * this file with their actual API is a mapping exercise in one place, not a rewrite.
 *
 * When their spec arrives, the things to check, in order of how badly each fails:
 *
 *   1. **Store scoping.** We send `store_id` on catalogue reads. If their API instead
 *      scopes by the API key itself (one key per store), then `store_id` is redundant and,
 *      worse, the multi-store behaviour the validation suite asserts in R2.7-R2.9 needs
 *      rethinking — SnapUp would need one key per store rather than one key overall.
 *   2. **Money units.** We use integer paise throughout and assume they do too. If they
 *      send rupees as a decimal, every price in the system is wrong by a factor of 100 and
 *      the exit token would be signed over the wrong amount. Convert in `toProduct` and
 *      nowhere else.
 *   3. **Whether the commercial fields come back at all.** `cost_price` and
 *      `profit_margin_pct` feed the owner's gross-profit figure. If their API withholds
 *      them from our key, the margin metric cannot be computed and must render as `—`
 *      rather than as zero.
 *   4. **Timestamps.** We use epoch milliseconds. ISO 8601 strings need parsing in the
 *      mappers below, not at the call sites.
 */

export const PATHS = {
  storeById: (id: string) => `stores/${encodeURIComponent(id)}`,
  stores: 'stores',
  productByBarcode: (barcode: string) => `products/barcode/${encodeURIComponent(barcode)}`,
  productSearch: 'products/search',
  products: 'products',
  productById: (id: string) => `products/${encodeURIComponent(id)}`,
  orders: 'orders',
  orderById: (id: string) => `orders/${encodeURIComponent(id)}`,
  orderPayment: (id: string) => `orders/${encodeURIComponent(id)}/payment`,
  events: 'events',
  eventsEarliest: 'events/earliest',
} as const;

// ---------------------------------------------------------------------------
// Wire shapes we expect back
// ---------------------------------------------------------------------------

export interface StoreDto {
  id: string;
  name: string;
  address: string;
  /** Null when the branch has not been surveyed. See `toStoreRecord`. */
  latitude: number | string | null;
  longitude: number | string | null;
  authorized_egress_cidrs: string[] | null;
  advertised_ssid: string;
  merchant_vpa: string | null;
  merchant_display_name: string | null;
  /** Per-branch retail API. Optional — a retailer running one system omits both. */
  api_base_url?: string | null;
  /** Environment-variable *name*, never a key. */
  api_key_ref?: string | null;
  is_active: boolean;
  is_open: boolean;
}

export interface ProductDto {
  id: string;
  store_id: string;
  barcode: string;
  name: string;
  category: string;
  aisle: string | null;
  image_url: string;
  unit_price: number | string;
  expected_weight_grams: number | string;
  is_active: boolean;
  cost_price: number | string | null;
  profit_margin_pct: number | string | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  stock_quantity: number | string | null;
  internal_sku: string | null;
  purchase_history: InternalProduct['purchase_history'] | null;
}

export interface PagedProductsDto {
  items: ProductDto[];
  page?: number;
  page_size?: number;
  total?: number;
}

export interface OrderLineDto {
  product_id: string;
  barcode: string;
  name: string;
  quantity: number | string;
  unit_price_paise: number | string;
  line_paise: number | string;
  unit_cost_paise: number | string;
  line_cost_paise: number | string;
  expected_weight_grams: number | string;
}

export interface OrderDto {
  id: string;
  store_id: string;
  session_id: string;
  status: OrderRecord['status'];
  lines: OrderLineDto[] | null;
  subtotal_paise: number | string;
  discount_paise: number | string;
  platform_fee_paise: number | string;
  total_paise: number | string;
  total_cost_paise: number | string;
  expected_weight_grams: number | string;
  created_at: number | string;
  paid_at: number | string | null;
  payee_vpa: string | null;
  payee_name: string | null;
  transaction_ref: string;
  confirmation: PaymentConfirmation;
}

export interface EventDto {
  id: string;
  store_id: string;
  session_id: string;
  kind: StoreEvent['kind'];
  occurred_at: number | string;
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Wire -> domain
// ---------------------------------------------------------------------------

/**
 * Numbers arrive as numbers or as strings depending on how the upstream serialises its
 * database types — `bigint` and `numeric` are commonly stringified to avoid precision loss.
 * Coercing once here keeps `"4200" + 100 === "4200100"` out of the pricing path.
 */
function num(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Accepts epoch milliseconds or an ISO 8601 string, since either is plausible. */
function epochMs(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toStoreRecord(dto: StoreDto): StoreRecord {
  return {
    // The retailer's own registry has no SnapUp console credential in it; a key pasted
    // here lives in SnapUp's store table, not theirs.
    ...NO_STORED_API_KEY,
    ...NO_STATED_HOURS,
    id: dto.id,
    name: dto.name,
    address: dto.address,
    // `num()` is not used here on purpose: it coerces null and unparseable values to 0,
    // which for a coordinate is a real position off the coast of Ghana rather than a
    // harmless default. An upstream that omits coordinates must read as "not surveyed".
    latitude: coordinate(dto.latitude),
    longitude: coordinate(dto.longitude),
    // Defaults to empty, which fails closed: a store whose network registration did not
    // come back grants no sessions rather than granting all of them.
    authorizedEgressCidrs: dto.authorized_egress_cidrs ?? [],
    advertisedSsid: dto.advertised_ssid,
    merchantVpa: dto.merchant_vpa ?? null,
    merchantDisplayName: dto.merchant_display_name ?? null,
    apiBaseUrl: dto.api_base_url ?? null,
    apiKeyRef: dto.api_key_ref ?? null,
    isActive: dto.is_active,
    isOpen: dto.is_open,
  };
}

/** A nullable coordinate from the wire, without inventing a position for a missing one. */
function coordinate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toInternalProduct(dto: ProductDto): InternalProduct {
  return {
    id: dto.id,
    store_id: dto.store_id,
    barcode: dto.barcode,
    name: dto.name,
    category: dto.category,
    aisle: dto.aisle ?? null,
    image_url: dto.image_url,
    unit_price: num(dto.unit_price),
    expected_weight_grams: num(dto.expected_weight_grams),
    is_active: dto.is_active,
    // The commercial fields default to zero/empty rather than throwing, so a key that is
    // not permitted to read them still yields a working customer catalogue. The owner's
    // margin figure degrades; scanning does not break.
    cost_price: num(dto.cost_price),
    profit_margin_pct: num(dto.profit_margin_pct),
    supplier_name: dto.supplier_name ?? '',
    supplier_contact: dto.supplier_contact ?? '',
    stock_quantity: num(dto.stock_quantity),
    internal_sku: dto.internal_sku ?? '',
    purchase_history: dto.purchase_history ?? [],
  };
}

export function toOrderRecord(dto: OrderDto): OrderRecord {
  return {
    // The retailer's order book has no SnapUp weight check in it.
    ...NO_WEIGHT_CHECK,
    id: dto.id,
    storeId: dto.store_id,
    sessionId: dto.session_id,
    userId: null,
    status: dto.status,

    // The retailer's API does not model SnapUp's staff-verification step — that is our
    // control over our own exit gate, not their retail data — so these stay null on this
    // path. A deployment running on a retailer order book has to record verification on
    // their side, or keep orders in SnapUp's own database.
    verificationCode: null,
    verifiedBy: null,
    verifiedAt: null,
    lines: (dto.lines ?? []).map((line) => ({
      productId: line.product_id,
      barcode: line.barcode,
      name: line.name,
      quantity: num(line.quantity),
      unitPricePaise: num(line.unit_price_paise),
      linePaise: num(line.line_paise),
      unitCostPaise: num(line.unit_cost_paise),
      lineCostPaise: num(line.line_cost_paise),
      expectedWeightGrams: num(line.expected_weight_grams),
    })),
    subtotalPaise: num(dto.subtotal_paise),
    // A retailer's order book has no Snap Up fee model in it, so these read as zero
    // rather than being invented from a rate we would then have to keep in step.
    productSavingsPaise: 0,
    serviceFeePaise: 0,
    gstPaise: 0,
    discountPaise: num(dto.discount_paise),
    platformFeePaise: num(dto.platform_fee_paise),
    totalPaise: num(dto.total_paise),
    totalCostPaise: num(dto.total_cost_paise),
    expectedWeightGrams: num(dto.expected_weight_grams),
    createdAt: epochMs(dto.created_at),
    paidAt: dto.paid_at === null || dto.paid_at === undefined ? null : epochMs(dto.paid_at),
    payment: {
      payeeVpa: dto.payee_vpa ?? null,
      payeeName: dto.payee_name ?? null,
      transactionRef: dto.transaction_ref,
      confirmation: dto.confirmation,
    },
  };
}

export function toStoreEvent(dto: EventDto): StoreEvent {
  return {
    id: dto.id,
    storeId: dto.store_id,
    sessionId: dto.session_id,
    kind: dto.kind,
    occurredAt: epochMs(dto.occurred_at),
    ...((dto.payload ?? {}) as Partial<StoreEvent>),
  };
}

// ---------------------------------------------------------------------------
// Domain -> wire
// ---------------------------------------------------------------------------

export function fromStoreDraft(draft: StoreDraft): Record<string, unknown> {
  return {
    name: draft.name,
    address: draft.address,
    latitude: draft.latitude,
    longitude: draft.longitude,
    authorized_egress_cidrs: draft.authorizedEgressCidrs,
    advertised_ssid: draft.advertisedSsid,
    merchant_vpa: draft.merchantVpa,
    merchant_display_name: draft.merchantDisplayName,
    api_base_url: draft.apiBaseUrl,
    api_key_ref: draft.apiKeyRef,
    is_active: draft.isActive,
    is_open: draft.isOpen,
  };
}

/**
 * Only the keys actually present are sent.
 *
 * `Partial<StoreDraft>` uses absence to mean "leave alone" and null to mean "clear this",
 * and those must stay distinguishable on the wire. Serialising the whole record with
 * `undefined` filled in would silently blank fields the operator never touched.
 */
export function fromStorePatch(patch: Partial<StoreDraft>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ('name' in patch) body.name = patch.name;
  if ('address' in patch) body.address = patch.address;
  if ('latitude' in patch) body.latitude = patch.latitude;
  if ('longitude' in patch) body.longitude = patch.longitude;
  if ('authorizedEgressCidrs' in patch) body.authorized_egress_cidrs = patch.authorizedEgressCidrs;
  if ('advertisedSsid' in patch) body.advertised_ssid = patch.advertisedSsid;
  if ('merchantVpa' in patch) body.merchant_vpa = patch.merchantVpa;
  if ('merchantDisplayName' in patch) body.merchant_display_name = patch.merchantDisplayName;
  if ('apiBaseUrl' in patch) body.api_base_url = patch.apiBaseUrl;
  if ('apiKeyRef' in patch) body.api_key_ref = patch.apiKeyRef;
  if ('isActive' in patch) body.is_active = patch.isActive;
  if ('isOpen' in patch) body.is_open = patch.isOpen;
  return body;
}

export function fromProductDraft(draft: ProductDraft): Record<string, unknown> {
  return {
    store_id: draft.store_id,
    barcode: draft.barcode,
    name: draft.name,
    category: draft.category,
    aisle: draft.aisle,
    image_url: draft.image_url,
    unit_price: draft.unit_price,
    expected_weight_grams: draft.expected_weight_grams,
    cost_price: draft.cost_price,
    supplier_name: draft.supplier_name,
    supplier_contact: draft.supplier_contact,
    stock_quantity: draft.stock_quantity,
    internal_sku: draft.internal_sku,
    is_active: draft.is_active,
  };
}

export function fromProductPatch(patch: Partial<ProductDraft>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const map: Record<keyof ProductDraft, string> = {
    store_id: 'store_id',
    barcode: 'barcode',
    name: 'name',
    category: 'category',
    aisle: 'aisle',
    image_url: 'image_url',
    unit_price: 'unit_price',
    expected_weight_grams: 'expected_weight_grams',
    cost_price: 'cost_price',
    supplier_name: 'supplier_name',
    supplier_contact: 'supplier_contact',
    stock_quantity: 'stock_quantity',
    internal_sku: 'internal_sku',
    is_active: 'is_active',
  };

  for (const key of Object.keys(patch) as (keyof ProductDraft)[]) {
    if (key in map) body[map[key]] = patch[key];
  }
  return body;
}

export function fromOrderRecord(order: Omit<OrderRecord, 'id'>): Record<string, unknown> {
  return {
    store_id: order.storeId,
    session_id: order.sessionId,
    status: order.status,
    lines: order.lines.map((line) => ({
      product_id: line.productId,
      barcode: line.barcode,
      name: line.name,
      quantity: line.quantity,
      unit_price_paise: line.unitPricePaise,
      line_paise: line.linePaise,
      unit_cost_paise: line.unitCostPaise,
      line_cost_paise: line.lineCostPaise,
      expected_weight_grams: line.expectedWeightGrams,
    })),
    subtotal_paise: order.subtotalPaise,
    discount_paise: order.discountPaise,
    platform_fee_paise: order.platformFeePaise,
    total_paise: order.totalPaise,
    total_cost_paise: order.totalCostPaise,
    expected_weight_grams: order.expectedWeightGrams,
    created_at: order.createdAt,
    paid_at: order.paidAt,
    payee_vpa: order.payment.payeeVpa,
    payee_name: order.payment.payeeName,
    transaction_ref: order.payment.transactionRef,
    confirmation: order.payment.confirmation,
  };
}

export function fromStoreEvent(event: Omit<StoreEvent, 'id'>): Record<string, unknown> {
  const { storeId, sessionId, kind, occurredAt, ...payload } = event;
  return {
    store_id: storeId,
    session_id: sessionId,
    kind,
    occurred_at: occurredAt,
    payload,
  };
}
