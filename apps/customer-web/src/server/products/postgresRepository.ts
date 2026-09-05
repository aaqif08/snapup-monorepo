import 'server-only';
import { db, isUniqueViolation } from '../db/client';
import { DuplicateBarcodeError } from './errors';
import { marginPct } from './margin';
import type { InternalProduct, PageMeta, ProductDraft, ProductRepository } from './types';

/**
 * The catalogue, durable.
 *
 * The in-memory version's three indexes each become an index on the table: the
 * `store_id:barcode` map is `products_store_barcode_idx`, the pre-sorted per-store list is
 * `products_store_name_idx`, and the id map is the primary key. Requirement 3's ~2s budget
 * is untouched by the move — an indexed single-row lookup is sub-millisecond in Postgres
 * too, and the budget was always dominated by network round-trip rather than by the lookup.
 *
 * One honest difference from the in-memory implementation, since the whole point of the
 * interface is that callers cannot tell them apart: **ordering**. The in-memory repository
 * sorts with `String.prototype.localeCompare`, this one with the database's collation.
 * They agree on ordinary ASCII product names and can disagree on punctuation and accents.
 * Nothing depends on the exact order — pagination needs it *stable*, not
 * locale-identical — which is why `id` is a tiebreak below.
 */

type ProductRow = Record<string, unknown>;

function toProduct(row: ProductRow): InternalProduct {
  return {
    id: row.id as string,
    store_id: row.store_id as string,
    barcode: row.barcode as string,
    name: row.name as string,
    category: row.category as string,
    aisle: (row.aisle as string | null) ?? null,
    image_url: row.image_url as string,
    unit_price: Number(row.unit_price),
    expected_weight_grams: Number(row.expected_weight_grams),
    is_active: row.is_active as boolean,
    cost_price: Number(row.cost_price),
    profit_margin_pct: Number(row.profit_margin_pct),
    supplier_name: row.supplier_name as string,
    supplier_contact: row.supplier_contact as string,
    stock_quantity: Number(row.stock_quantity),
    brand: (row.brand as string | null) ?? null,
    mrp_paise: row.mrp_paise === null || row.mrp_paise === undefined ? null : Number(row.mrp_paise),
    discount_paise: Number(row.discount_paise ?? 0),
    gst_amount_paise: Number(row.gst_amount_paise ?? 0),
    gst_rate_bp:
      row.gst_rate_bp === null || row.gst_rate_bp === undefined ? null : Number(row.gst_rate_bp),
    internal_sku: row.internal_sku as string,
    purchase_history: (row.purchase_history as InternalProduct['purchase_history']) ?? [],
  };
}

class PostgresProductRepository implements ProductRepository {
  async findByBarcode(storeId: string, barcode: string): Promise<InternalProduct | null> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM products
      WHERE store_id = ${storeId}
        AND barcode = ${barcode}
        AND is_active = true
    `) as ProductRow[];

    // `is_active` is filtered in the query rather than after it, so a withdrawn product is
    // indistinguishable from a missing one. Answering "this item is discontinued" would
    // confirm the barcode exists in this store's catalogue.
    return rows.length > 0 ? toProduct(rows[0]) : null;
  }

  async search(
    storeId: string,
    query: string,
    page: number,
    pageSize: number
  ): Promise<{ items: InternalProduct[]; meta: PageMeta }> {
    const sql = db();

    // Lowercased once here and compared with `strpos`, not `ILIKE`. `ILIKE '%' || q || '%'`
    // would treat a `%` or `_` typed by the customer as a wildcard — so a search for "50%
    // off" would match everything — whereas `strpos` is a plain substring test and matches
    // the `String.includes` semantics of the in-memory repository exactly.
    const normalized = query.trim().toLowerCase();

    const countRows = (await sql`
      SELECT COUNT(*)::int AS total FROM products
      WHERE store_id = ${storeId}
        AND is_active = true
        AND (
          ${normalized} = ''
          OR strpos(lower(name), ${normalized}) > 0
          OR strpos(lower(category), ${normalized}) > 0
          OR strpos(barcode, ${normalized}) > 0
        )
    `) as { total: number }[];

    const total = Number(countRows[0]?.total ?? 0);

    // Clamped before the offset is computed, matching the in-memory behaviour: asking for
    // page 50 of a 3-page result returns the last page rather than an empty list, so a
    // stale bookmark degrades instead of looking like an empty catalogue.
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = (await sql`
      SELECT * FROM products
      WHERE store_id = ${storeId}
        AND is_active = true
        AND (
          ${normalized} = ''
          OR strpos(lower(name), ${normalized}) > 0
          OR strpos(lower(category), ${normalized}) > 0
          OR strpos(barcode, ${normalized}) > 0
        )
      ORDER BY name, id
      LIMIT ${pageSize} OFFSET ${offset}
    `) as ProductRow[];

    return {
      items: rows.map(toProduct),
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
    const sql = db();
    // No `is_active` filter: withdrawn products still need managing, and the operator has
    // to be able to see the thing they withdrew in order to bring it back.
    const rows = (await sql`
      SELECT * FROM products WHERE store_id = ${storeId} ORDER BY name, id
    `) as ProductRow[];
    return rows.map(toProduct);
  }

  async create(draft: ProductDraft): Promise<InternalProduct> {
    const sql = db();

    try {
      const rows = (await sql`
        INSERT INTO products (
          id, store_id, barcode, name, category, aisle, image_url, unit_price,
          expected_weight_grams, is_active, cost_price, profit_margin_pct,
          supplier_name, supplier_contact, stock_quantity, internal_sku, purchase_history
        ) VALUES (
          'p_' || nextval('product_id_seq'),
          ${draft.store_id},
          ${draft.barcode},
          ${draft.name},
          ${draft.category},
          ${draft.aisle},
          ${draft.image_url},
          ${draft.unit_price},
          ${draft.expected_weight_grams},
          ${draft.is_active},
          ${draft.cost_price},
          ${marginPct(draft.unit_price, draft.cost_price)},
          ${draft.supplier_name},
          ${draft.supplier_contact},
          ${draft.stock_quantity},
          ${draft.internal_sku},
          '[]'::jsonb
        )
        RETURNING *
      `) as ProductRow[];

      return toProduct(rows[0]);
    } catch (error) {
      // The uniqueness rule is enforced by the index, not by a preceding SELECT. A
      // check-then-insert would leave a window in which two concurrent operator saves both
      // see no conflict and both insert — the exact race the in-memory version could not
      // have, because it was single-threaded. Translating the constraint violation keeps
      // the route's `409 duplicate_barcode` correct without reintroducing that window.
      if (isUniqueViolation(error)) {
        throw new DuplicateBarcodeError(draft.barcode, draft.store_id);
      }
      throw error;
    }
  }

  async update(id: string, patch: Partial<ProductDraft>): Promise<InternalProduct | null> {
    const sql = db();

    const existingRows = (await sql`
      SELECT * FROM products WHERE id = ${id}
    `) as ProductRow[];
    if (existingRows.length === 0) return null;

    // Read-merge-write, for the same reason as the store registry: `Partial<ProductDraft>`
    // uses absence to mean "leave alone", and `aisle` uses null to mean "unmapped", which a
    // COALESCE-based update cannot tell apart.
    const existing = toProduct(existingRows[0]);
    const merged: InternalProduct = { ...existing, ...patch, id: existing.id };
    merged.profit_margin_pct = marginPct(merged.unit_price, merged.cost_price);

    try {
      const rows = (await sql`
        UPDATE products SET
          store_id              = ${merged.store_id},
          barcode               = ${merged.barcode},
          name                  = ${merged.name},
          category              = ${merged.category},
          aisle                 = ${merged.aisle},
          image_url             = ${merged.image_url},
          unit_price            = ${merged.unit_price},
          expected_weight_grams = ${merged.expected_weight_grams},
          is_active             = ${merged.is_active},
          cost_price            = ${merged.cost_price},
          profit_margin_pct     = ${merged.profit_margin_pct},
          supplier_name         = ${merged.supplier_name},
          supplier_contact      = ${merged.supplier_contact},
          stock_quantity        = ${merged.stock_quantity},
          internal_sku          = ${merged.internal_sku}
        WHERE id = ${id}
        RETURNING *
      `) as ProductRow[];

      return rows.length > 0 ? toProduct(rows[0]) : null;
    } catch (error) {
      // Re-keying onto a barcode another product already holds in that store.
      if (isUniqueViolation(error)) {
        throw new DuplicateBarcodeError(merged.barcode, merged.store_id);
      }
      throw error;
    }
  }
}

export const postgresProductRepository: ProductRepository = new PostgresProductRepository();
