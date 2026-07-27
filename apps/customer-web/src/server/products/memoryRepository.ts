import 'server-only';
import { PRODUCT_SEED } from './seed';
import type { InternalProduct, PageMeta, ProductRepository } from './types';

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

  constructor(seed: InternalProduct[]) {
    for (const item of seed) {
      const key = this.barcodeKey(item.store_id, item.barcode);
      if (this.barcodeIndex.has(key)) {
        // Mirrors the UNIQUE (store_id, barcode) constraint the real table will carry.
        // Failing loudly at boot beats silently serving whichever row happened to win.
        throw new Error(`Duplicate barcode ${item.barcode} for store ${item.store_id}`);
      }
      this.barcodeIndex.set(key, item);

      const list = this.byStore.get(item.store_id);
      if (list) list.push(item);
      else this.byStore.set(item.store_id, [item]);
    }

    for (const list of this.byStore.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  private barcodeKey(storeId: string, barcode: string) {
    return `${storeId}:${barcode}`;
  }

  async findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null> {
    return this.barcodeIndex.get(this.barcodeKey(storeId, barcode)) ?? null;
  }

  async search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }> {
    const all = this.byStore.get(storeId) ?? [];

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
}

export const productRepository: ProductRepository = new InMemoryProductRepository(PRODUCT_SEED);
