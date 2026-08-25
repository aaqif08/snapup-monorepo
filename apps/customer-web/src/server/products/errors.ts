import 'server-only';

/**
 * Raised when a product would collide with an existing one on `(store_id, barcode)`.
 *
 * This lives outside any repository implementation on purpose. Both the in-memory and the
 * Postgres repository raise it — the first by checking its index, the second by translating
 * Postgres error `23505` on the unique constraint — and `api/admin/products` catches it to
 * return `409 duplicate_barcode`. If it were exported from one implementation, swapping the
 * repository would silently change which class the route's `instanceof` check compares
 * against, and the 409 would quietly become a 500.
 */
export class DuplicateBarcodeError extends Error {
  constructor(readonly barcode: string, readonly storeId: string) {
    super(`Barcode ${barcode} is already used by another product in ${storeId}.`);
    this.name = 'DuplicateBarcodeError';
  }
}
