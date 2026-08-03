'use client';

import { RegistryError } from '@/lib/storesClient';

/**
 * Browser-side client for the real product catalogue.
 *
 * Money crosses this boundary as **integer paise**, matching the catalogue itself. The
 * console converts to rupees only for display and back at the edge of the form, so no
 * float ever reaches storage — see `rupeesToPaise` / `paiseToRupees` below.
 */

export interface AdminProduct {
  id: string;
  store_id: string;
  barcode: string;
  name: string;
  category: string;
  /** Shelf location, e.g. "Aisle 4 — Dairy". Null when not mapped. */
  aisle: string | null;
  image_url: string;
  unit_price: number;
  expected_weight_grams: number;
  is_active: boolean;
  cost_price: number;
  profit_margin_pct: number;
  supplier_name: string;
  supplier_contact: string;
  stock_quantity: number;
  internal_sku: string;
}

export interface ProductDraft {
  store_id: string;
  barcode: string;
  name: string;
  category: string;
  aisle: string | null;
  image_url: string;
  unit_price: number;
  expected_weight_grams: number;
  cost_price: number;
  supplier_name: string;
  supplier_contact: string;
  stock_quantity: number;
  internal_sku: string;
  is_active: boolean;
}

export interface ProductsResult {
  store: { id: string; name: string };
  products: AdminProduct[];
}

export interface SaveProductResult {
  product: AdminProduct;
  warnings: string[];
}

async function readError(response: Response): Promise<RegistryError> {
  try {
    const body = await response.json();
    if (body?.error?.code) {
      return new RegistryError(body.error.code, body.error.message, response.status);
    }
  } catch {
    /* fall through */
  }
  return new RegistryError('request_failed', `Request failed (${response.status}).`, response.status);
}

export async function listProducts(storeId: string): Promise<ProductsResult> {
  const response = await fetch(`/api/products?store_id=${encodeURIComponent(storeId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ProductsResult;
}

export async function createProduct(draft: ProductDraft): Promise<SaveProductResult> {
  const response = await fetch('/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return { product: body.product, warnings: body.warnings ?? [] };
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductDraft>
): Promise<SaveProductResult> {
  const response = await fetch(`/api/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return { product: body.product, warnings: body.warnings ?? [] };
}

/**
 * Rupees (as typed) to integer paise (as stored).
 *
 * Rounded rather than truncated, because `1.15 * 100` is `114.99999999999999` in binary
 * floating point and truncation would silently shave a paisa off prices ending in
 * certain decimals.
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}
