'use client';

import { useCallback, useEffect, useState } from 'react';
import { listStaff, type AccountUser } from '@/lib/accountClient';
import Link from 'next/link';
import { listStores, type AdminStore } from '@/lib/storesClient';
import { listProducts } from '@/lib/productsClient';

/**
 * Operational overview.
 *
 * Every number here is counted from the live registry — there is no sample data behind
 * this screen. It replaced a dashboard of charts driven by MOCK_SALES and MOCK_TRAFFIC,
 * which showed revenue and footfall this system has never measured. Five true numbers are
 * worth more than a wall of invented ones, and a buyer who finds one fabricated chart
 * stops believing the rest of the console.
 */
interface Overview {
  stores: AdminStore[];
  productCount: number;
  withdrawnCount: number;
  storesMissingNetwork: AdminStore[];
  storesWithPlaceholderNetwork: AdminStore[];
}

/** RFC 5737 documentation ranges — never routable, so never a real store gateway. */
function isPlaceholderRange(cidr: string): boolean {
  return (
    cidr.startsWith('192.0.2.') || cidr.startsWith('198.51.100.') || cidr.startsWith('203.0.113.')
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  // Loaded separately from the registry overview: staff live in SnapUp's own tables, and
  // a manager may read them while the registry call is still in flight.
  const [team, setTeam] = useState<AccountUser[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const stores = await listStores();

      // Counted per store because the catalogue is store-scoped; there is deliberately no
      // endpoint that returns every product across every store at once.
      const catalogues = await Promise.all(
        stores.map((store) =>
          listProducts(store.id).catch(() => ({
            store: { id: store.id, name: store.name },
            products: [],
          }))
        )
      );
      const allProducts = catalogues.flatMap((entry) => entry.products);

      setOverview({
        stores,
        productCount: allProducts.filter((product) => product.is_active).length,
        withdrawnCount: allProducts.filter((product) => !product.is_active).length,
        storesMissingNetwork: stores.filter((store) => store.authorized_egress_cidrs.length === 0),
        storesWithPlaceholderNetwork: stores.filter(
          (store) => store.is_active && store.authorized_egress_cidrs.some(isPlaceholderRange)
        ),
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the overview.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Silent on failure: a `staff` role is forbidden from listing the team, and that is
    // an expected answer rather than an error worth showing on the landing screen.
    void listStaff()
      .then((result) => setTeam(result.staff))
      .catch(() => setTeam(null));
  }, []);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-28 animate-pulse rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-danger/40 bg-danger/5 p-6">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-xl bg-danger px-4 py-2 text-xs font-extrabold text-surface"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeStores = overview.stores.filter((store) => store.is_active);
  const needsAttention = [
    ...overview.storesMissingNetwork.map((store) => ({
      store,
      severity: 'blocking' as const,
      message: 'No authorized network — every customer here is refused.',
    })),
    ...overview.storesWithPlaceholderNetwork.map((store) => ({
      store,
      severity: 'warning' as const,
      message: 'Using a placeholder IP range. Replace with the real gateway IP before go-live.',
    })),
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Overview</h1>
        <p className="mt-1 text-sm text-muted">
          Counted live from the store registry and catalogue.
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Active stores"
          value={activeStores.length}
          sub={`${overview.stores.length} registered`}
        />
        <Stat
          label="Products live"
          value={overview.productCount}
          sub={`${overview.withdrawnCount} withdrawn`}
        />
        <Stat
          label="Stores needing setup"
          value={needsAttention.length}
          sub={needsAttention.length === 0 ? 'all configured' : 'see below'}
          tone={needsAttention.length > 0 ? 'warning' : 'normal'}
        />
        {team ? (
          <Link href="/staff" className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Stat
              label="Team"
              value={team.filter((member) => member.isActive).length}
              sub={
                team.some((member) => !member.isActive)
                  ? `${team.filter((member) => !member.isActive).length} awaiting approval`
                  : 'all approved'
              }
              tone={team.some((member) => !member.isActive) ? 'warning' : 'normal'}
            />
          </Link>
        ) : (
          <Stat label="Presence checks" value="Enforced" sub="QR + store network" />
        )}
      </div>

      {needsAttention.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
            Needs attention
          </h2>
          <div className="space-y-2">
            {needsAttention.map(({ store, severity, message }) => (
              <div
                key={`${store.id}-${severity}`}
                className={`rounded-2xl border p-4 ${
                  severity === 'blocking'
                    ? 'border-danger/40 bg-danger/5'
                    : 'border-warning/40 bg-warning/10'
                }`}
              >
                <p
                  className={`text-sm font-extrabold ${
                    severity === 'blocking' ? 'text-danger' : 'text-warning'
                  }`}
                >
                  {store.name} <span className="font-mono text-xs font-normal">{store.id}</span>
                </p>
                <p
                  className={`mt-0.5 text-xs ${
                    severity === 'blocking' ? 'text-danger' : 'text-warning'
                  }`}
                >
                  {message}
                </p>
              </div>
            ))}
          </div>
          <Link
            href="/stores"
            className="mt-3 inline-block text-xs font-extrabold text-primary hover:underline"
          >
            Go to Stores →
          </Link>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">Stores</h2>
        {overview.stores.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            No stores registered yet.{' '}
            <Link href="/stores" className="font-extrabold text-primary hover:underline">
              Add the first one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {overview.stores.map((store) => (
              <div
                key={store.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div>
                  <p className="font-bold text-ink">
                    {store.name}
                    {!store.is_active && (
                      <span className="ml-2 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-extrabold text-muted">
                        INACTIVE
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">{store.address}</p>
                </div>
                <span
                  className={`text-xs font-extrabold ${store.is_open ? 'text-primary' : 'text-danger'}`}
                >
                  {store.is_open ? 'OPEN' : 'CLOSED'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'normal',
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: 'normal' | 'warning';
}) {
  return (
    <div
      className={`rounded-2xl border bg-surface p-5 shadow-card transition-colors duration-200 ${
        tone === 'warning' ? 'border-warning/40' : 'border-border'
      }`}
    >
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-2 text-3xl font-extrabold tabular-nums tracking-tight ${
          tone === 'warning' ? 'text-warning' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}
