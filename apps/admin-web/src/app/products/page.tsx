'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ProductFormModal from '@/components/ProductFormModal';
import BarcodeScanModal from '@/components/BarcodeScanModal';
import { listStores, type AdminStore } from '@/lib/storesClient';
import {
  createProduct,
  listProducts,
  paiseToRupees,
  updateProduct,
  type AdminProduct,
  type ProductDraft,
} from '@/lib/productsClient';

type ModalState =
  | { mode: 'closed' }
  | { mode: 'scan' }
  | { mode: 'create'; barcode?: string }
  | { mode: 'edit'; product: AdminProduct };

export default function ProductsPage() {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [products, setProducts] = useState<AdminProduct[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });

  // A catalogue belongs to a store, so the store has to be chosen before there is
  // anything to show. Defaults to the first registered store.
  useEffect(() => {
    let cancelled = false;
    listStores()
      .then((loaded) => {
        if (cancelled) return;
        setStores(loaded);
        if (loaded.length > 0) setStoreId((current) => current || loaded[0].id);
        else setIsLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load stores.');
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await listProducts(storeId);
      setProducts(result.products);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load products.');
    } finally {
      setIsLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.barcode.includes(query) ||
        product.category.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  /**
   * Routes a scanned barcode to the right screen.
   *
   * Scanning something already stocked opens it for editing instead of starting a new
   * product. Without this the operator fills in the whole form and is refused at save with
   * `409 duplicate_barcode` — technically correct and a dead end. In a shop the common
   * reason to scan an item you already sell is to correct its price or restock it, so that
   * is the flow the scan should land in.
   */
  const handleScanned = (barcode: string) => {
    const existing = products.find((product) => product.barcode === barcode);
    setModal(existing ? { mode: 'edit', product: existing } : { mode: 'create', barcode });
  };

  const handleSave = async (draft: ProductDraft) => {
    const result =
      modal.mode === 'edit'
        ? await updateProduct(modal.product.id, draft)
        : await createProduct(draft);
    setWarnings(result.warnings);
    setModal({ mode: 'closed' });
    await load();
  };

  const toggleActive = async (product: AdminProduct) => {
    try {
      const result = await updateProduct(product.id, { is_active: !product.is_active });
      setWarnings(result.warnings);
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the product.');
    }
  };

  const activeCount = products.filter((product) => product.is_active).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-extrabold text-ink">Products</h1>
          <p className="text-sm text-muted">
            {activeCount} available to customers, {products.length - activeCount} withdrawn
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-primary"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name} ({store.id})
              </option>
            ))}
          </select>
          <button
            onClick={() => setModal({ mode: 'scan' })}
            disabled={!storeId}
            className="rounded-xl border border-primary px-5 py-2.5 text-sm font-extrabold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            Scan Product
          </button>
          <button
            onClick={() => setModal({ mode: 'create' })}
            disabled={!storeId}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
          >
            + Add Product
          </button>
        </div>
      </div>

      {stores.length === 0 && !isLoading && !error && (
        <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          No stores registered yet. Add a store first — a catalogue belongs to a store.
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-400/50 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-amber-700">
            Saved with warnings
          </p>
          <ul className="list-inside list-disc space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="text-sm leading-relaxed text-amber-900">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-danger/40 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-xs font-extrabold text-danger underline">
            Retry
          </button>
        </div>
      )}

      {storeId && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, barcode, or category"
          className="mb-5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-ink outline-none focus:border-primary"
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      ) : storeId && filtered.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          {searchQuery.trim()
            ? `No products match “${searchQuery}”.`
            : 'No products in this store yet.'}
        </p>
      ) : (
        storeId && (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-border bg-bg px-5 py-3 text-xs font-extrabold uppercase tracking-wide text-muted lg:grid">
              <span>Product</span>
              <span>Category</span>
              <span>Price</span>
              <span>Margin</span>
              <span>Stock</span>
              <span>Actions</span>
            </div>

            {filtered.map((product) => (
              <div
                key={product.id}
                className="flex flex-col gap-3 border-b border-border p-5 last:border-b-0 lg:grid lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-4"
              >
                <div>
                  <p className="font-bold text-ink">
                    {product.name}
                    {!product.is_active && (
                      <span className="ml-2 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-extrabold text-muted">
                        WITHDRAWN
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-muted">{product.barcode}</p>
                </div>
                <span className="text-sm text-ink">{product.category}</span>
                <span className="text-sm font-bold text-ink">
                  ₹{paiseToRupees(product.unit_price).toFixed(2)}
                </span>
                <span
                  className={`text-sm font-bold ${
                    product.profit_margin_pct < 0 ? 'text-danger' : 'text-ink'
                  }`}
                >
                  {product.profit_margin_pct.toFixed(1)}%
                </span>
                <span className="text-sm font-bold text-ink">{product.stock_quantity}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setModal({ mode: 'edit', product })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-primary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void toggleActive(product)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                      product.is_active
                        ? 'border border-danger/30 text-danger hover:bg-danger/10'
                        : 'border border-primary/30 text-primary hover:bg-primary/10'
                    }`}
                  >
                    {product.is_active ? 'Withdraw' : 'Restore'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <p className="mt-4 text-xs text-muted">
        “Withdraw” hides a product from the customer app rather than deleting it — past
        orders still reference it, so the record is kept.
      </p>

      {modal.mode === 'scan' && storeId && (
        <BarcodeScanModal
          title="Scan a product"
          hint="Already in this catalogue? It opens for editing. New to the shop? The form opens with the barcode filled in."
          onDetected={handleScanned}
          onClose={() => setModal({ mode: 'closed' })}
        />
      )}

      {(modal.mode === 'create' || modal.mode === 'edit') && storeId && (
        <ProductFormModal
          storeId={storeId}
          initial={modal.mode === 'edit' ? modal.product : undefined}
          initialBarcode={modal.mode === 'create' ? modal.barcode : undefined}
          onSave={handleSave}
          onClose={() => setModal({ mode: 'closed' })}
        />
      )}
    </div>
  );
}
