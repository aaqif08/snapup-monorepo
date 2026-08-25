'use client';

export interface Bill {
  id: string;
  store_id: string;
  store_name: string;
  status: 'awaiting_payment' | 'awaiting_verification' | 'paid' | 'abandoned';
  confirmation: string;
  total_paise: number;
  subtotal_paise: number;
  discount_paise: number;
  platform_fee_paise: number;
  items: number;
  lines: { name: string; quantity: number; unit_price_paise: number; line_paise: number }[];
  transaction_ref: string;
  created_at: number;
  paid_at: number | null;
}

/**
 * The bill, as the customer's record of a shop.
 *
 * ## Why this is not headed "TAX INVOICE"
 *
 * The design shows a GST invoice with a CGST/SGST/Cess split and a GSTIN. Producing one
 * would mean inventing three things the system does not have:
 *
 *   - a **GST rate per product** (0/5/12/18/28% — it is not one rate, and groceries span
 *     most of the range)
 *   - an **HSN code** per line, which a tax invoice must carry
 *   - the **store's GSTIN**
 *
 * Splitting an MRP into tax components without those is arithmetic dressed as compliance,
 * and a tax invoice is a legal document — a wrong one is the retailer's problem, not a
 * cosmetic bug. So this shows the real figures and says plainly that GST is included in
 * the price, which is true of Indian MRP.
 *
 * To turn this into a real tax invoice, the catalogue needs `gst_rate` and `hsn_code` per
 * product and the store registry needs `gstin`. The layout below is built to take them.
 */
export default function TaxInvoice({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const paid = bill.status === 'paid';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Bill from ${bill.store_name}`}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="my-8 w-full max-w-sm animate-scale-in rounded-2xl border border-border bg-surface p-5 shadow-pop"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Bill</p>
            <p className="truncate text-sm font-extrabold text-ink">{bill.store_name}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {formatDateTime(bill.paid_at ?? bill.created_at)}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted">Ref {bill.transaction_ref}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close bill"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="pb-1.5 font-semibold">Item</th>
              <th className="pb-1.5 text-center font-semibold">Qty</th>
              <th className="pb-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((line, index) => (
              <tr key={index} className="border-b border-border/60 last:border-b-0">
                <td className="py-1.5 pr-2 text-ink">{line.name}</td>
                <td className="py-1.5 text-center tabular-nums text-muted">{line.quantity}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums text-ink">
                  {rupees(line.line_paise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 border-t border-border pt-3 text-[12px]">
          <Row label="Subtotal" value={rupees(bill.subtotal_paise)} />
          {bill.discount_paise > 0 && (
            <Row label="Discount" value={`−${rupees(bill.discount_paise)}`} tone="text-primary" />
          )}
          {bill.platform_fee_paise > 0 && (
            <Row label="Platform fee" value={rupees(bill.platform_fee_paise)} />
          )}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-extrabold text-ink">Grand Total</span>
          <span className="text-lg font-extrabold tabular-nums text-ink">
            {rupees(bill.total_paise)}
          </span>
        </div>

        {/* Stated rather than broken down, because MRP in India is tax-inclusive and the
            catalogue carries no per-product rate to split it with. */}
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          GST is included in the price. A full tax invoice with the CGST/SGST split is
          available from the store counter.
        </p>

        <div className="mt-4 flex items-center justify-between">
          {paid ? (
            <span className="rotate-[-6deg] rounded border-2 border-primary px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-widest text-primary">
              Paid
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-warning">
              {bill.status === 'awaiting_verification' ? 'Awaiting check' : 'Unpaid'}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted">{bill.id}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-semibold tabular-nums ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  );
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
