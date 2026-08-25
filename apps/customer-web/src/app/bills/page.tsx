'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ScreenHeader from '@/components/ScreenHeader';
import TaxInvoice, { type Bill } from '@/components/TaxInvoice';

/**
 * My Bills.
 *
 * Bills belong to the *account*, not to the shopping session, which is why this needs a
 * signed-in customer and says so plainly when there is not one. A guest's receipts exist
 * only on the device that made them — that is the trade a guest makes, and it is better
 * said here than discovered when someone changes phone.
 */
export default function BillsPage() {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Bill | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/bills', { credentials: 'same-origin', cache: 'no-store' });
        const body = await response.json();
        setSignedIn(Boolean(body.signed_in));
        setBills(body.bills ?? []);
      } catch {
        setError('Could not load your bills. Check your connection.');
        setBills([]);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="My Bills" icon={<BillsMark />} />

      <div className="px-4 pb-4">
        {bills === null ? (
          <div className="space-y-2.5 pt-2">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-24 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : !signedIn ? (
          <Empty
            title="Sign in to see your bills"
            body="Bills are saved to your account, so they follow you to a new phone. Guest receipts stay on the device that made them."
            action={{ href: '/login?redirect=/bills', label: 'Sign in with your mobile' }}
          />
        ) : bills.length === 0 ? (
          <Empty
            title="No bills yet"
            body="Every shop you complete through SnapUp is saved here as a GST invoice."
            action={{ href: '/scan', label: 'Start shopping' }}
          />
        ) : (
          <ul className="space-y-2.5 pt-2">
            {bills.map((bill) => (
              <li key={bill.id}>
                <button
                  onClick={() => setOpen(bill)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition-transform active:scale-[0.99]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg text-sm font-extrabold text-ink">
                    {bill.store_name.slice(0, 2).toUpperCase()}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">
                      Bill from {bill.store_name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {formatDate(bill.paid_at ?? bill.created_at)} · {bill.items} item
                      {bill.items === 1 ? '' : 's'}
                    </span>
                    <span className="mt-1.5 inline-flex items-center gap-2">
                      <span className="text-sm font-extrabold text-ink">
                        {rupees(bill.total_paise)}
                      </span>
                      <StatusChip status={bill.status} />
                    </span>
                  </span>

                  <span className="shrink-0 text-xs font-extrabold text-primary underline underline-offset-2">
                    View Bill
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && <TaxInvoice bill={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatusChip({ status }: { status: Bill['status'] }) {
  const style =
    status === 'paid'
      ? 'bg-primary/10 text-primary'
      : status === 'awaiting_verification'
        ? 'bg-warning/15 text-warning'
        : 'bg-muted/15 text-muted';

  const label =
    status === 'paid'
      ? 'Paid'
      : status === 'awaiting_verification'
        ? 'Awaiting check'
        : status === 'awaiting_payment'
          ? 'Unpaid'
          : 'Abandoned';

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${style}`}>
      {label}
    </span>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="px-2 py-16 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-tint text-3xl" aria-hidden>
        🧾
      </div>
      <p className="mt-5 text-base font-extrabold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted">{body}</p>
      <Link
        href={action.href}
        className="mt-6 inline-flex rounded-2xl bg-primary px-6 py-3 text-sm font-extrabold text-onPrimary"
      >
        {action.label}
      </Link>
    </div>
  );
}

function BillsMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2).replace(/\.00$/, '')}`;
}
