'use client';

import { useMemo, useState } from 'react';
import ProductFormModal from '@/components/ProductFormModal';
import { useProductStore } from '@/store/useProductStore';
import type { AdminProduct } from '@/lib/mockData';

export default function ProductsPage() {
  const { products, addProduct, updateProduct, deactivateProduct, reactivateProduct } = useProductStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.category.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const handleAddSave = (data: Omit<AdminProduct, 'id' | 'isActive'>) => {
    addProduct({ ...data, isActive: true });
    setIsAdding(false);
  };

  const handleEditSave = (data: Omit<AdminProduct, 'id' | 'isActive'>) => {
    if (editingProduct) {
      updateProduct(editingProduct.id, data);
    }
    setEditingProduct(null);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-extrabold text-ink">Products</h1>
          <p className="text-sm text-muted">{products.filter((p) => p.isActive).length} active products</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white hover:opacity-90"
        >
          + Add Product
        </button>
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by name, barcode, or category"
        className="mb-5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-ink outline-none focus:border-primary"
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Desktop table header */}
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-border bg-bg px-5 py-3 text-xs font-extrabold uppercase tracking-wide text-muted lg:grid">
          <span>Product</span>
          <span>Category</span>
          <span>Price</span>
          <span>Stock</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">No products match &ldquo;{searchQuery}&rdquo;.</p>
        ) : (
          filtered.map((product) => {
            const isLowStock = product.isActive && product.quantityOnHand <= product.reorderThreshold;
            return (
              <div
                key={product.id}
                className="flex flex-col gap-3 border-b border-border p-5 last:border-b-0 lg:grid lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-4"
              >
                <div>
                  <p className="font-bold text-ink">{product.name}</p>
                  <p className="text-xs text-muted">{product.barcode}</p>
                </div>
                <span className="text-sm text-ink">{product.category}</span>
                <span className="text-sm font-bold text-ink">₹{product.unitPrice.toFixed(2)}</span>
                <span className={`text-sm font-bold ${isLowStock ? 'text-warning' : 'text-ink'}`}>
                  {product.quantityOnHand} {isLowStock && '⚠️'}
                </span>
                <span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                      product.isActive ? 'bg-primary/10 text-primary' : 'bg-muted/10 text-muted'
                    }`}
                  >
                    {product.isActive ? 'Active' : 'Inactive'}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingProduct(product)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-primary"
                  >
                    Edit
                  </button>
                  {product.isActive ? (
                    <button
                      onClick={() => deactivateProduct(product.id)}
                      className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/10"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => reactivateProduct(product.id)}
                      className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        &ldquo;Remove&rdquo; deactivates a product rather than deleting it — past orders still reference it, so
        the record is kept and just hidden from the customer app&apos;s catalog.
      </p>

      {isAdding && <ProductFormModal onSave={handleAddSave} onClose={() => setIsAdding(false)} />}
      {editingProduct && (
        <ProductFormModal
          initial={editingProduct}
          onSave={handleEditSave}
          onClose={() => setEditingProduct(null)}
        />
      )}
    </div>
  );
}
