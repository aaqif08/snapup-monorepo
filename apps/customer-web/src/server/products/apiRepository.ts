import 'server-only';
import { StoreApiError, storeApiFind, storeApiRequest } from '../storeApi/client';
import { connectionForStoreId } from '../storeApi/routing';
import { sharedCache } from '../storeApi/cache';
import {
  PATHS,
  fromProductDraft,
  fromProductPatch,
  toInternalProduct,
  type PagedProductsDto,
  type ProductDto,
} from '../storeApi/contract';
import { DuplicateBarcodeError } from './errors';
import type { InternalProduct, PageMeta, ProductDraft, ProductRepository } from './types';

/**
 * The catalogue, read from the retailer's API.
 *
 * This is the repository the arrangement suits best. The supermarket's own system is the
 * authority on what is on its shelves and what it costs, so reading through their API means
 * price and stock are correct by construction — there is no copy of the catalogue to drift
 * out of date, and no synchronisation job to fail quietly overnight.
 *
 * What it costs is the Requirement 3 latency story. A barcode lookup was ~0.1 ms against an
 * in-memory map; it is now a round trip to somebody else's infrastructure. Still
 * comfortably inside the 2 s target, but the headroom is theirs to spend rather than ours,
 * which is why the short-lived cache below exists and why the client-side cache in
 * `lib/api.ts` stops being an optimisation and becomes load-bearing.
 *
 * Requirement 2 is unaffected, and worth being explicit about: whatever their API returns —
 * including cost, margin and supplier columns — `toPublicProduct()` still copies out an
 * allowlist of six fields. The projection is what protects the customer boundary, not the
 * shape of the upstream response.
 */

/**
 * Five seconds. Long enough to absorb a customer scanning the same item repeatedly and the
 * burst of lookups a basket review produces, short enough that a price corrected at the
 * till is live almost immediately. Prices changing mid-trip is a real retail event, not a
 * hypothetical.
 */
const PRODUCT_CACHE_TTL_MS = 5_000;

function cache() {
  return sharedCache<InternalProduct>('products', PRODUCT_CACHE_TTL_MS, 2000);
}

function cacheKey(storeId: string, barcode: string) {
  return `${storeId}:${barcode}`;
}

class ApiProductRepository implements ProductRepository {
  async findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null> {
    const key = cacheKey(storeId, barcode);
    const cached = cache().get(key);
    if (cached) return { ...cached };

    const dto = await storeApiFind<ProductDto>(PATHS.productByBarcode(barcode), {
      query: { store_id: storeId },
      // Routed to this branch's own endpoint. `store_id` is still sent because a chain
      // running one central system needs it to disambiguate, and a branch running its own
      // needs it for the guard below — the parameter and the endpoint are belt and braces
      // against the same failure, serving another store's pricing under this session.
      connection: await connectionForStoreId(storeId),
    });
    if (!dto) return null;

    const product = toInternalProduct(dto);

    // Two guards against trusting the upstream more than we should.
    //
    // The store check is the important one: `store_id` is taken from the *signed session*,
    // and if their API ignored the parameter and answered from another store we would serve
    // that store's pricing under this store's session — which is exactly what R2.7 and R2.9
    // exist to prevent. Failing closed here keeps that property ours rather than theirs.
    if (product.store_id !== storeId) return null;

    // Withdrawn products are invisible to customers, and indistinguishable from products
    // that never existed. Filtered here as well as in the query, because "did you also
    // apply the is_active filter" is not a question we can answer about someone else's API.
    if (!product.is_active) return null;

    cache().set(key, product);
    return { ...product };
  }

  async search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }> {
    const response = await storeApiRequest<PagedProductsDto>(PATHS.productSearch, {
      query: {
        store_id: storeId,
        q: query.trim(),
        page,
        page_size: pageSize,
      },
      connection: await connectionForStoreId(storeId),
    });

    const items = (response?.items ?? [])
      .map(toInternalProduct)
      // Same two guards as the single lookup. Search is the easier of the two paths to
      // forget, and a bulk-shaped endpoint that leaked another store's catalogue would leak
      // all of it at once rather than one item at a time.
      .filter((item) => item.store_id === storeId && item.is_active);

    // Pagination metadata is recomputed rather than passed through. Their `total` may count
    // rows we just filtered out, and the page-clamping behaviour the customer UI depends on
    // — asking for page 50 of a 3-page result returns the last page rather than an empty
    // list — is ours to define, not theirs.
    const total = Number(response?.total ?? items.length);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    return {
      items,
      meta: {
        page: safePage,
        page_size: pageSize,
        total,
        total_pages: totalPages,
        has_next: safePage < totalPages,
      },
    };
  }

  // ---- Operator path ----

  async listAllForStore(storeId: string): Promise<InternalProduct[]> {
    const dtos = await storeApiRequest<ProductDto[]>(PATHS.products, {
      query: { store_id: storeId },
      connection: await connectionForStoreId(storeId),
    });

    // No `is_active` filter: the operator has to be able to see what they withdrew in order
    // to bring it back.
    return (dtos ?? []).map(toInternalProduct).filter((item) => item.store_id === storeId);
  }

  async create(draft: ProductDraft): Promise<InternalProduct> {
    try {
      const dto = await storeApiRequest<ProductDto>(PATHS.products, {
        method: 'POST',
        body: fromProductDraft(draft),
        connection: await connectionForStoreId(draft.store_id),
      });
      cache().invalidate(cacheKey(draft.store_id, draft.barcode));
      return toInternalProduct(dto);
    } catch (error) {
      // Their 409 becomes our `DuplicateBarcodeError`, so the admin route keeps returning
      // `409 duplicate_barcode` rather than a 500. Uniqueness is enforced upstream now —
      // we cannot check it ourselves without a read-then-write race across a network.
      if (error instanceof StoreApiError && error.failure === 'conflict') {
        throw new DuplicateBarcodeError(draft.barcode, draft.store_id);
      }
      throw error;
    }
  }

  async update(id: string, patch: Partial<ProductDraft>): Promise<InternalProduct | null> {
    try {
      const dto = await storeApiFind<ProductDto>(PATHS.productById(id), {
        method: 'PATCH',
        body: fromProductPatch(patch),
        // A patch that does not carry `store_id` cannot be routed to a branch, so it falls
        // through to the platform connection. That is correct for a central system and is
        // why the admin product form always sends the store — see the callers.
        connection: patch.store_id ? await connectionForStoreId(patch.store_id) : undefined,
      });
      if (!dto) return null;

      const product = toInternalProduct(dto);

      // The barcode may have moved, so both the old and the new key have to go. The patch
      // carries only the new one, which is why the updated record is used for the second.
      if (patch.barcode && patch.store_id) {
        cache().invalidate(cacheKey(patch.store_id, patch.barcode));
      }
      cache().invalidate(cacheKey(product.store_id, product.barcode));

      return product;
    } catch (error) {
      if (error instanceof StoreApiError && error.failure === 'conflict') {
        throw new DuplicateBarcodeError(patch.barcode ?? '', patch.store_id ?? '');
      }
      throw error;
    }
  }
}

export const apiProductRepository: ProductRepository = new ApiProductRepository();
