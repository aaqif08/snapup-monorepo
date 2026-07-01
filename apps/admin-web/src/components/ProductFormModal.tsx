'use client';

import { useState } from 'react';
import type { AdminProduct } from '@/lib/mockData';

interface ProductFormModalProps {
  initial?: AdminProduct;
  onSave: (data: Omit<AdminProduct, 'id' | 'isActive'>) => void;
  onClose: () => void;
}

const CATEGORIES = ['Staples', 'Beverages', 'Dairy', 'Snacks', 'Produce', 'Household'];

export default function ProductFormModal({ initial, onSave, onClose }: ProductFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? '');
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice?.toString() ?? '');
  const [weight, setWeight] = useState(initial?.expectedWeightGrams?.toString() ?? '');
  const [stock, setStock] = useState(initial?.quantityOnHand?.toString() ?? '');
  const [reorderThreshold, setReorderThreshold] = useState(initial?.reorderThreshold?.toString() ?? '10');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !barcode.trim()) {
      setError('Name and barcode are required.');
      return;
    }
    const parsedPrice = parseFloat(unitPrice);
    const parsedWeight = parseFloat(weight);
    const parsedStock = parseInt(stock, 10);
    const parsedThreshold = parseInt(reorderThreshold, 10);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Enter a valid unit price.');
      return;
    }
    if (Number.isNaN(parsedWeight) || parsedWeight <= 0) {
      setError('Enter a valid expected weight in grams.');
      return;
    }
    setError(null);
    onSave({
      name: name.trim(),
      barcode: barcode.trim(),
      category,
      unitPrice: parsedPrice,
      expectedWeightGrams: parsedWeight,
      quantityOnHand: Number.isNaN(parsedStock) ? 0 : parsedStock,
      reorderThreshold: Number.isNaN(parsedThreshold) ? 10 : parsedThreshold,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl">
        <h2 className="mb-4 text-lg font-extrabold text-ink">
          {initial ? 'Edit Product' : 'Add New Product'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Product Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
              placeholder="e.g. Basmati Rice 1kg"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Barcode</label>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
              placeholder="e.g. 890123456001"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Unit Price (₹)</label>
              <input
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
                placeholder="120.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Weight (g)</label>
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
                placeholder="1000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Stock on Hand</label>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
                placeholder="50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Reorder Threshold</label>
              <input
                value={reorderThreshold}
                onChange={(e) => setReorderThreshold(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
                placeholder="10"
              />
            </div>
          </div>

          {error && <p className="text-sm font-semibold text-danger">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-extrabold text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-extrabold text-white hover:opacity-90"
            >
              {initial ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
