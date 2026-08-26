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
    /** Summed from the catalogue at order time — not anything the customer's phone set. */
    expected_weight_grams: number;
    /** Sent by the server so the figure on screen is the one it judges against. */
    tolerance_grams: number;
  };
  store: { id: string; name: string };
  customer_claims_paid: boolean;
  coverage: {
    total_units: number;
    unchecked_units: number;
    unchecked_names: string[];
    checked_rupees: string;
    unchecked_rupees: string;
  };
  /** Present only when the tolerance is wide enough to hide the shop's lightest item. */
  blind_spot: { lightest_item_grams: number; lightest_item_name: string } | null;
}

interface GapExplanation {
  gapGrams: number;
  lightestItemGrams: number | null;
  lightestItemName: string | null;
  belowLightestItem: boolean;
  candidates: { name: string; unitGrams: number; count: number; residualGrams: number }[];
}

interface WeightResult {
  expectedGrams: number;
  observedGrams: number;
  differenceGrams: number;
  toleranceGrams: number;
  matches: boolean;
  direction: 'heavier' | 'lighter' | 'exact';
}

type Screen =
  | { kind: 'entry' }
  | { kind: 'found'; lookup: VerifyLookup }
  /**
   * The scale disagreed. A separate screen rather than an inline error because the
   * decision it asks for — let this basket go anyway — is one the member of staff must
   * take deliberately, and it is recorded against them.
   */
  | {
      kind: 'mismatch';
      lookup: VerifyLookup;
      weight: WeightResult;
      message: string;
      explanation: GapExplanation | null;
    }
  | { kind: 'done'; total: string; by: string | null; weight: WeightResult | null; overridden: boolean };

export default function VerifyPage() {
  const user = useAdminAuthStore((state) => state.user);

  const [code, setCode] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'entry' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The scale reading, in grams, as typed. Kept as a string so the field can be empty. */
  const [observed, setObserved] = useState('');

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

  /**
   * Confirm the basket and, when a reading was taken, the weight.
   *
   * `override` is passed only from the mismatch screen. The server judges the comparison
   * either way — this screen shows it, it does not decide it — so a first tap can never
   * wave through a basket that is a kilo heavy.
   */
  async function confirm(lookupResult: VerifyLookup, override = false) {
    setBusy(true);
    setError(null);

    const reading = observed.trim();
    const payload: { observed_weight_grams?: number; override?: boolean } = {};
    if (reading !== '') {
      payload.observed_weight_grams = Number(reading);
      if (override) payload.override = true;
    }

    try {
      const response = await fetch(
        `/api/verify/${encodeURIComponent(lookupResult.order.code)}${storeQuery()}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json();

      // 409 with a weight is not an error to report — it is the scale disagreeing, which
      // is a normal outcome this screen has a state for.
      if (response.status === 409 && body?.reason === 'weight_mismatch') {
        setScreen({
          kind: 'mismatch',
          lookup: lookupResult,
          weight: body.weight as WeightResult,
          message: body.message ?? 'The basket does not match its expected weight.',
          explanation: (body.explanation as GapExplanation | null) ?? null,
        });
        return;
      }

      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not confirm.');
        return;
      }

      setScreen({
        kind: 'done',
        total: body.total_rupees,
        by: body.verified_by ?? null,
        weight: (body.weight as WeightResult | null) ?? null,
        overridden: Boolean(body.weight_overridden),
      });
      setCode('');
      setObserved('');
    } catch {
      setError('Could not reach SnapUp. The payment was NOT confirmed.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setScreen({ kind: 'entry' });
    setCode('');
    setObserved('');
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

          {/* The scale step. Optional by design: a branch without a scale leaves it blank
              and the payment check stands on its own, which is why the button below does
              not require it. */}
          <div className="border-t border-border p-4">
            <label
              htmlFor="observed-weight"
              className="text-[11px] font-extrabold uppercase tracking-wide text-muted"
            >
              Weight on the scale
            </label>
            <div className="mt-2 flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  id="observed-weight"
                  value={observed}
                  onChange={(event) => setObserved(event.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="grams"
                  className="w-full rounded-xl border border-border bg-bg px-3 py-3 pr-10 font-mono text-lg tabular-nums text-ink outline-none focus:border-primary"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">
                  g
                </span>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                  Should be
                </p>
                <p className="font-mono text-lg font-extrabold tabular-nums text-ink">
                  {screen.lookup.order.expected_weight_grams} g
                </p>
                <p className="text-[11px] font-semibold text-muted">
                  ± {screen.lookup.order.tolerance_grams} g
                </p>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Ask the customer to put every item on the scale. Leave blank if this exit has
              no scale.
            </p>

            {/* Shown before weighing, not after. Knowing that three items carry no weight
                changes how staff read the number — it is the difference between an
                informed override and a reflexive one. */}
            {screen.lookup.coverage.unchecked_units > 0 && (
              <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-warning">
                  Weight check is partial
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">
                  Covers ₹{screen.lookup.coverage.checked_rupees} of ₹
                  {(
                    Number(screen.lookup.coverage.checked_rupees) +
                    Number(screen.lookup.coverage.unchecked_rupees)
                  ).toFixed(2)}
                  . {screen.lookup.coverage.unchecked_units} item
                  {screen.lookup.coverage.unchecked_units === 1 ? ' has' : 's have'} no recorded
                  weight, so the total below does not include{' '}
                  {screen.lookup.coverage.unchecked_units === 1 ? 'it' : 'them'}:
                </p>
                <p className="mt-1 text-[13px] font-bold text-ink">
                  {screen.lookup.coverage.unchecked_names.join(', ')}
                </p>
                <p className="mt-1.5 text-[12px] text-muted">
                  Check those by eye. A scanned item with no weight makes the basket read
                  heavy for an entirely innocent reason.
                </p>
              </div>
            )}

            {screen.lookup.blind_spot && (
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Note: this basket&rsquo;s allowance (± {screen.lookup.order.tolerance_grams} g) is
                wider than the lightest item in stock (
                {screen.lookup.blind_spot.lightest_item_name},{' '}
                {screen.lookup.blind_spot.lightest_item_grams} g), so weight alone cannot rule
                one out.
              </p>
            )}
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

      {screen.kind === 'mismatch' && (
        <div className="rounded-3xl border border-danger/40 bg-danger/5 p-6">
          <p className="text-xs font-extrabold uppercase tracking-wide text-danger">
            Weight does not match
          </p>
          <p className="mt-2 text-lg font-extrabold leading-snug text-ink">{screen.message}</p>

          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Reading label="Expected" value={`${screen.weight.expectedGrams} g`} />
            <Reading label="On the scale" value={`${screen.weight.observedGrams} g`} />
            <Reading
              label="Difference"
              value={`${screen.weight.differenceGrams > 0 ? '+' : ''}${screen.weight.differenceGrams} g`}
              tone="danger"
            />
          </div>

          {/* The whole point of the exercise: turn a number into something to look for. */}
          {screen.explanation && screen.explanation.candidates.length > 0 && (
            <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                A difference this size matches
              </p>
              <ul className="mt-2 space-y-1.5">
                {screen.explanation.candidates.map((candidate) => (
                  <li
                    key={`${candidate.name}-${candidate.count}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 font-bold text-ink">
                      {candidate.count > 1 && (
                        <span className="mr-1.5 text-muted">{candidate.count}×</span>
                      )}
                      {candidate.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {candidate.unitGrams * candidate.count} g
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
                Ask the customer to check for these before deciding.
              </p>
            </div>
          )}

          {screen.explanation?.belowLightestItem && (
            <div className="mt-5 rounded-2xl border border-primary/40 bg-primary/5 p-4">
              <p className="text-[13px] leading-relaxed text-ink">
                <strong className="font-extrabold">Nothing in this shop weighs that little.</strong>{' '}
                The lightest item in stock is {screen.explanation.lightestItemName} at{' '}
                {screen.explanation.lightestItemGrams} g, and the difference is only{' '}
                {screen.explanation.gapGrams} g — so no missing item explains it. This is
                almost certainly the scale or packaging, not a basket problem.
              </p>
            </div>
          )}

          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Allowed difference is ± {screen.weight.toleranceGrams} g. If the basket is
            genuinely correct you can let it through — that decision is recorded against your
            account.
          </p>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => {
                setScreen({ kind: 'found', lookup: screen.lookup });
              }}
              disabled={busy}
              className="flex-[2] rounded-xl bg-primary py-3.5 text-sm font-extrabold text-onPrimary disabled:opacity-50"
            >
              Re-weigh the basket
            </button>
            <button
              onClick={() => void confirm(screen.lookup, true)}
              disabled={busy}
              className="flex-1 rounded-xl border border-danger/50 py-3.5 text-sm font-extrabold text-danger disabled:opacity-50"
            >
              {busy ? 'Approving…' : 'Approve anyway'}
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

          {screen.weight && (
            <p
              className={`mt-4 inline-block rounded-xl px-3 py-1.5 text-[12px] font-bold ${
                screen.overridden ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'
              }`}
            >
              {screen.overridden ? 'Weight overridden: ' : 'Weight matched: '}
              {screen.weight.observedGrams} g against {screen.weight.expectedGrams} g
              {screen.overridden
                ? ` (${screen.weight.differenceGrams > 0 ? '+' : ''}${screen.weight.differenceGrams} g)`
                : ''}
            </p>
          )}
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

/** One figure in the mismatch comparison. */
function Reading({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1 font-mono text-base font-extrabold tabular-nums ${
          tone === 'danger' ? 'text-danger' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
