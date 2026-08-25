import 'server-only';
import { DuplicateBarcodeError } from './errors';
import { marginPct } from './margin';
import { PRODUCT_SEED } from './seed';
import type { InternalProduct, PageMeta, ProductDraft, ProductRepository } from './types';

/**
 * In-memory repository backing the POC.
 *
 * Requirement 3 asks for "indexed barcode lookup" under ~2s. The index below is a hash
 * map keyed by `store_id:barcode`, so lookup is O(1) and completes in microseconds —
 * the 2s budget is then spent almost entirely on network round-trip, which is where the
 * remaining optimisation work (caching, payload size) is aimed.
 *
 * Requirement 4 asks that the architecture scale without redesign. That is why callers
 * depend on the `ProductRepository` interface and never on this module: swapping to
 * Postgres means writing a `PostgresProductRepository` with the same three methods and
 * changing the export in `index.ts`. The barcode index becomes
 * `CREATE UNIQUE INDEX ON products (store_id, barcode)` and the pagination below becomes
 * LIMIT/OFFSET; no calling code changes.
 */
class InMemoryProductRepository implements ProductRepository {
  /** `store_id:barcode` -> product. The R3 hot path. */
  private readonly barcodeIndex = new Map<string, InternalProduct>();
  /** `store_id` -> products, pre-sorted by name so pagination is stable across requests. */
  private readonly byStore = new Map<string, InternalProduct[]>();
  /** `id` -> product, for operator edits which address by id rather than barcode. */
  private readonly byId = new Map<string, InternalProduct>();
  private nextId: number;

  constructor(seed: InternalProduct[]) {
    for (const item of seed) {
      if (this.barcodeIndex.has(this.barcodeKey(item.store_id, item.barcode))) {
        // Mirrors the UNIQUE (store_id, barcode) constraint the real table will carry.
        // Failing loudly at boot beats silently serving whichever row happened to win.
        throw new Error(`Duplicate barcode ${item.barcode} for store ${item.store_id}`);
      }
      this.index(item);
    }

    // Continue the `p_N` sequence past the seed so a generated id cannot collide.
    const highest = seed.reduce((max, item) => {
      const numeric = Number(/^p_?(\d+)$/.exec(item.id)?.[1]);
      return Number.isInteger(numeric) && numeric > max ? numeric : max;
    }, 0);
    this.nextId = highest + 1;
  }

  /** Adds a product to every index and restores the per-store name ordering. */
  private index(product: InternalProduct) {
    this.barcodeIndex.set(this.barcodeKey(product.store_id, product.barcode), product);
    this.byId.set(product.id, product);

    const list = this.byStore.get(product.store_id);
    if (list) list.push(product);
    else this.byStore.set(product.store_id, [product]);

    this.byStore.get(product.store_id)!.sort((a, b) => a.name.localeCompare(b.name));
  }

  private barcodeKey(storeId: string, barcode: string) {
    return `${storeId}:${barcode}`;
  }

  async findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null> {
    const found = this.barcodeIndex.get(this.barcodeKey(storeId, barcode));
    // A withdrawn product is indistinguishable from a missing one to a customer. Saying
    // "this item is discontinued" would confirm the barcode exists in this store's
    // catalogue, which is the sort of detail bulk lookups get built out of.
    return found && found.is_active ? found : null;
  }

  async search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }> {
    const all = (this.byStore.get(storeId) ?? []).filter((item) => item.is_active);

    const normalized = query.trim().toLowerCase();
    const matched = normalized
      ? all.filter(
          (item) =>
            item.name.toLowerCase().includes(normalized) ||
            item.category.toLowerCase().includes(normalized) ||
            item.barcode.includes(normalized)
        )
      : all;

    const total = matched.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;

    return {
      items: matched.slice(start, start + pageSize),
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
    return [...(this.byStore.get(storeId) ?? [])];
  }

  async create(draft: ProductDraft): Promise<InternalProduct> {
    const key = this.barcodeKey(draft.store_id, draft.barcode);
    if (this.barcodeIndex.has(key)) {
      // Mirrors the UNIQUE (store_id, barcode) constraint the real table carries. Two rows
      // with the same barcode in one store would make scan results depend on iteration
      // order, which is the kind of bug that only shows up in the shop.
      throw new DuplicateBarcodeError(draft.barcode, draft.store_id);
    }

    const product: InternalProduct = {
      id: `p_${this.nextId++}`,
      store_id: draft.store_id,
      barcode: draft.barcode,
      name: draft.name,
      category: draft.category,
      aisle: draft.aisle,
      image_url: draft.image_url,
      unit_price: draft.unit_price,
      expected_weight_grams: draft.expected_weight_grams,
      is_active: draft.is_active,
      cost_price: draft.cost_price,
      profit_margin_pct: marginPct(draft.unit_price, draft.cost_price),
      supplier_name: draft.supplier_name,
      supplier_contact: draft.supplier_contact,
      stock_quantity: draft.stock_quantity,
      internal_sku: draft.internal_sku,
      purchase_history: [],
    };

    this.index(product);
    return { ...product };
  }

  async update(id: string, patch: Partial<ProductDraft>): Promise<InternalProduct | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    // Barcode and store are identity here, so a change means re-keying the index rather
    // than mutating in place and leaving a stale entry pointing at the old value.
    const nextBarcode = patch.barcode ?? existing.barcode;
    const nextStoreId = patch.store_id ?? existing.store_id;
    const keyChanged =
      nextBarcode !== existing.barcode || nextStoreId !== existing.store_id;

    if (keyChanged && this.barcodeIndex.has(this.barcodeKey(nextStoreId, nextBarcode))) {
      throw new DuplicateBarcodeError(nextBarcode, nextStoreId);
    }

    const updated: InternalProduct = { ...existing, ...patch, id: existing.id };
    updated.profit_margin_pct = marginPct(updated.unit_price, updated.cost_price);

    if (keyChanged) {
      this.barcodeIndex.delete(this.barcodeKey(existing.store_id, existing.barcode));
      const oldList = this.byStore.get(existing.store_id);
      if (oldList) {
        const at = oldList.findIndex((item) => item.id === id);
        if (at >= 0) oldList.splice(at, 1);
      }
      this.index(updated);
    } else {
      this.byId.set(id, updated);
      this.barcodeIndex.set(this.barcodeKey(nextStoreId, nextBarcode), updated);
      const list = this.byStore.get(nextStoreId);
      if (list) {
        const at = list.findIndex((item) => item.id === id);
        if (at >= 0) list[at] = updated;
        list.sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    return { ...updated };
  }
}

export const memoryProductRepository: ProductRepository = new InMemoryProductRepository(
  PRODUCT_SEED
);
