'use client';

import { useState } from 'react';
import BarcodeScanModal from '@/components/BarcodeScanModal';
import {
  paiseToRupees,
  rupeesToPaise,
  type AdminProduct,
  type ProductDraft,
} from '@/lib/productsClient';

interface ProductFormModalProps {
  storeId: string;
  initial?: AdminProduct;
  /**
   * Pre-fills the barcode when the form was opened by scanning an item that is not yet in
   * the catalogue, so the operator does not scan and then retype the same digits.
   */
  initialBarcode?: string;
  onSave: (draft: ProductDraft) => Promise<void>;
  onClose: () => void;
}

const CATEGORIES = [
  'Staples',
  'Beverages',
  'Dairy',
  'Snacks',
  'Produce',
  'Household',
  'Personal Care',
];

export default function ProductFormModal({
  storeId,
  initial,
  initialBarcode,
  onSave,
  onClose,
}: ProductFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? initialBarcode ?? '');
  const [isScanning, setIsScanning] = useState(false);
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [aisle, setAisle] = useState(initial?.aisle ?? '');
  const [unitPrice, setUnitPrice] = useState(
    initial ? String(paiseToRupees(initial.unit_price)) : ''
  );
  const [costPrice, setCostPrice] = useState(
    initial ? String(paiseToRupees(initial.cost_price)) : ''
  );
  const [weight, setWeight] = useState(initial?.expected_weight_grams?.toString() ?? '');
  const [stock, setStock] = useState(initial?.stock_quantity?.toString() ?? '0');
  const [sku, setSku] = useState(initial?.internal_sku ?? '');
  const [supplierName, setSupplierName] = useState(initial?.supplier_name ?? '');
  const [supplierContact, setSupplierContact] = useState(initial?.supplier_contact ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim() || !barcode.trim()) {
      setError('Name and barcode are required.');
      return;
    }
    if (!/^\d{6,14}$/.test(barcode.trim())) {
      setError('Barcode must be 6-14 digits.');
      return;
    }

    const parsedUnit = Number(unitPrice);
    const parsedCost = Number(costPrice);
    const parsedWeight = Number(weight);
    const parsedStock = Number(stock);

    if (!Number.isFinite(parsedUnit) || parsedUnit < 0) {
      setError('Enter a valid selling price.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setError('Enter a valid cost price.');
      return;
    }
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setError('Enter a valid expected weight in grams.');
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await onSave({
        store_id: storeId,
        barcode: barcode.trim(),
        name: name.trim(),
        category,
        // Optional. Aisle traffic falls back to category when this is blank, so a
        // catalogue can be loaded first and shelf locations mapped later.
        aisle: aisle.trim() || null,
        image_url: imageUrl.trim(),
        // Converted at the edge so nothing downstream holds money as a float.
        unit_price: rupeesToPaise(parsedUnit),
        cost_price: rupeesToPaise(parsedCost),
        expected_weight_grams: Math.round(parsedWeight),
        stock_quantity: Number.isFinite(parsedStock) ? Math.round(parsedStock) : 0,
        internal_sku: sku.trim() || `SKU-${barcode.trim()}`,
        supplier_name: supplierName.trim() || 'Unspecified',
        supplier_contact: supplierContact.trim() || 'Unspecified',
        is_active: isActive,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the product.');
      setIsSaving(false);
    }
  };

  if (isScanning) {
    return (
      <BarcodeScanModal
        title="Scan the product barcode"
        hint="Hold the item's barcode inside the frame. The digits go straight into the form."
        onDetected={(scanned) => {
          setBarcode(scanned);
          setIsScanning(false);
        }}
        onClose={() => setIsScanning(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/50 backdrop-blur-sm sm:items-center">
      <div className="my-8 w-full max-w-md animate-fade-in-up rounded-t-3xl border border-border bg-surface p-6 shadow-pop sm:rounded-3xl">
        <h2 className="mb-1 text-lg font-extrabold text-ink">
          {initial ? 'Edit Product' : 'Add New Product'}
        </h2>
        <p className="mb-4 text-xs text-muted">
          Saved to the live catalogue customers scan in this store.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Product Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Basmati Rice 1kg" />
          </Field>

          <Field label="Barcode">
            <div className="flex gap-2">
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={`${inputClass} font-mono`}
                placeholder="890123456001"
              />
              {/* Typing a 13-digit EAN off a packet is the single most error-prone field on
                  this form, and a wrong digit produces a product no customer can ever scan. */}
              <button
                type="button"
                onClick={() => setIsScanning(true)}
                className="shrink-0 rounded-xl border border-border px-3 py-2.5 text-sm font-extrabold text-primary transition-colors duration-200 hover:border-primary"
              >
                Scan
              </button>
            </div>
          </Field>

          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Aisle (optional)">
            <input
              value={aisle}
              onChange={(e) => setAisle(e.target.value)}
              className={inputClass}
              placeholder="e.g. Aisle 4 — Dairy"
            />
          </Field>
          <p className="-mt-1 text-[11px] leading-relaxed text-muted">
            Used for the aisle-traffic report in Insights. Leave blank and scans are grouped
            by category instead.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Selling Price (₹)">
              <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} inputMode="decimal" className={inputClass} placeholder="120.00" />
            </Field>
            <Field label="Cost Price (₹)">
              <input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} inputMode="decimal" className={inputClass} placeholder="95.00" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected Weight (g)">
              <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className={inputClass} placeholder="1000" />
            </Field>
            <Field label="Stock on Hand">
              <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" className={inputClass} placeholder="50" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Internal SKU">
              <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} placeholder="STP-BAS-1K" />
            </Field>
            <Field label="Image path">
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={inputClass} placeholder="/products/rice.png" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier">
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={inputClass} placeholder="ITC Foods" />
            </Field>
            <Field label="Supplier Contact">
              <input value={supplierContact} onChange={(e) => setSupplierContact(e.target.value)} className={inputClass} placeholder="foods@itc.example" />
            </Field>
          </div>

          {/* Named explicitly because these are the fields Requirement 2 keeps off the
              customer's phone — an operator should know the difference. */}
          <p className="rounded-xl border border-border bg-bg p-3 text-[11px] leading-relaxed text-muted">
            Cost price, margin, supplier and SKU are <strong>never</strong> sent to
            customers. Shoppers receive only name, barcode, selling price, image and
            expected weight.
          </p>

          <label className="flex items-center gap-2 text-xs font-bold text-ink">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
            Available to customers
          </label>

          {error && <p className="text-sm font-semibold text-danger">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 rounded-xl border border-border py-3 text-sm font-extrabold text-ink disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="flex-1 rounded-xl bg-primary py-3 text-sm font-extrabold text-onPrimary hover:opacity-90 disabled:opacity-50">
              {isSaving ? 'Saving…' : initial ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-muted">{label}</label>
      {children}
    </div>
  );
}
