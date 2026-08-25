'use client';

import { useEffect, useRef, useState } from 'react';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { listStores, type AdminStore } from '@/lib/storesClient';

/**
 * The exit desk.
 *
 * A customer has tapped "I've paid" and is standing at the gate. Under the
 * direct-to-merchant UPI model no provider tells SnapUp anything, so this screen is the
 * only thing between a claim and an opened gate: staff type the code, check the amount
 * against the shop's own UPI app, and confirm.
 *
 * Designed for the physical situation rather than for a dashboard. The code entry is huge
 * and always focused, because it is used one-handed at a counter with a queue behind it.
 * The amount is the largest thing on the result, because matching the amount *is* the job
 * — everything else is context.
 */

interface VerifyLookup {
  order: {
    id: string;
    code: string;
    status: string;
    confirmation: string;
    total_rupees: string;
    items: number;
    lines: { name: string; quantity: number; line_rupees: string }[];
    transaction_ref: string;
    payee_vpa: string | null;
    created_at: number;
  };
  store: { id: string; name: string };
  customer_claims_paid: boolean;
}

type Screen =
  | { kind: 'entry' }
  | { kind: 'found'; lookup: VerifyLookup }
  | { kind: 'done'; total: string; by: string | null };

export default function VerifyPage() {
  const user = useAdminAuthStore((state) => state.user);

  const [code, setCode] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'entry' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Owners and managers are not tied to a branch, so they have to say which exit they are
  // standing at. A staff account carries its own store and never sees this.
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [storeId, setStoreId] = useState('');
  const needsStore = Boolean(user && !user.storeId);

  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!needsStore) return;
    void listStores()
      .then((rows) => {
        const active = rows.filter((row) => row.is_active);
        setStores(active);
        setStoreId((current) => current || active[0]?.id || '');
      })
      .catch(() => setStores([]));
  }, [needsStore]);

  // Refocused after every transition. Staff never touch the keyboard to get back here.
  useEffect(() => {
    if (screen.kind === 'entry') input.current?.focus();
  }, [screen]);

  function storeQuery() {
    return needsStore && storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
  }

  async function lookup(value: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/verify/${encodeURIComponent(value)}${storeQuery()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not look that up.');
        setCode('');
        return;
      }
      setScreen({ kind: 'found', lookup: body as VerifyLookup });
    } catch {
      setError('Could not reach SnapUp. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(lookupResult: VerifyLookup) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/verify/${encodeURIComponent(lookupResult.order.code)}${storeQuery()}`,
        { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not confirm.');
        return;
      }
      setScreen({ kind: 'done', total: body.total_rupees, by: body.verified_by ?? null });
      setCode('');
    } catch {
      setError('Could not reach SnapUp. The payment was NOT confirmed.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setScreen({ kind: 'entry' });
    setCode('');
    setError(null);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Exit desk</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Check the payment in the shop&apos;s own UPI app, then confirm. This is the only
          thing that opens the gate — the customer&apos;s &ldquo;I&apos;ve paid&rdquo; is a
          claim, not evidence.
        </p>
      </header>

      {needsStore && (
        <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
          <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">
            Which exit are you at?
          </label>
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
          >
            {stores.length === 0 && <option value="">No active branches</option>}
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {screen.kind === 'entry' && (
        <div className="rounded-3xl border border-border bg-surface p-6">
          <label
            htmlFor="code"
            className="mb-2 block text-xs font-extrabold uppercase tracking-wide text-muted"
          >
            Customer&apos;s six-character code
          </label>
          <input
            id="code"
            ref={input}
            value={code}
            onChange={(event) => {
              const next = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
              setCode(next);
              // Submitted on the sixth character. At a counter, "type it and it goes" beats
              // "type it, then find the button" every time.
              if (next.length === 6 && !busy) void lookup(next);
            }}
            placeholder="K7F2QM"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={busy || (needsStore && !storeId)}
            className="w-full rounded-2xl border-2 border-border bg-bg px-4 py-5 text-center font-mono text-4xl font-extrabold uppercase tracking-[0.4em] text-ink outline-none transition-colors focus:border-primary disabled:opacity-50"
          />
          <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
            The code has no O, 0, I or 1 — if you see one of those, it is a misread.
          </p>
        </div>
      )}

      {screen.kind === 'found' && (
        <div className="overflow-hidden rounded-3xl border border-border bg-surface">
          {/* The amount dominates, because matching the amount is the entire task. */}
          <div className="border-b border-border bg-tint px-6 py-6 text-center">
            <p className="text-xs font-extrabold uppercase tracking-wide text-muted">
              Check this amount in the shop&apos;s UPI app
            </p>
            <p className="mt-1 text-5xl font-extrabold tabular-nums text-ink">
              ₹{screen.lookup.order.total_rupees}
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted">
              ref {screen.lookup.order.transaction_ref}
            </p>
          </div>

          {!screen.lookup.customer_claims_paid && (
            <p className="border-b border-border bg-warning/10 px-6 py-3 text-[12px] font-semibold leading-relaxed text-warning">
              This customer has not marked the order as paid in the app yet. They may be at
              the wrong desk, or still paying.
            </p>
          )}

          <div className="px-6 py-4">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">
              {screen.lookup.order.items} item{screen.lookup.order.items === 1 ? '' : 's'} ·{' '}
              {screen.lookup.store.name}
            </p>
            <ul className="divide-y divide-border">
              {screen.lookup.order.lines.map((line, index) => (
                <li key={index} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {line.quantity > 1 && (
                      <span className="mr-1.5 font-extrabold text-muted">{line.quantity}×</span>
                    )}
                    {line.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-muted">
                    ₹{line.line_rupees}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-3 border-t border-border p-4">
            <button
              onClick={reset}
              disabled={busy}
              className="flex-1 rounded-xl border border-border py-3.5 text-sm font-extrabold text-ink disabled:opacity-50"
            >
              Not paid — cancel
            </button>
            <button
              onClick={() => void confirm(screen.lookup)}
              disabled={busy}
              className="flex-[2] rounded-xl bg-primary py-3.5 text-sm font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Confirming…' : 'Payment received — open gate'}
            </button>
          </div>
        </div>
      )}

      {screen.kind === 'done' && (
        <div className="rounded-3xl border border-primary/40 bg-primary/5 p-8 text-center">
          <p className="text-5xl" aria-hidden>
            ✓
          </p>
          <p className="mt-3 text-2xl font-extrabold text-ink">₹{screen.total} confirmed</p>
          <p className="mt-1 text-sm text-muted">
            Recorded against {screen.by ?? 'your account'}. The customer can leave.
          </p>
          <button
            onClick={reset}
            className="mt-6 w-full rounded-xl bg-accent py-3.5 text-sm font-extrabold text-onAccent transition hover:opacity-90"
          >
            Next customer
          </button>
        </div>
      )}
    </div>
  );
}
