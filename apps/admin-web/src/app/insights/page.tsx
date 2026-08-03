'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listStores, type AdminStore } from '@/lib/storesClient';
import {
  fetchAnalytics,
  formatRupees,
  type AnalyticsResponse,
  type AnalyticsWindow,
} from '@/lib/analyticsClient';

/**
 * Store insights — the screen a supermarket owner opens.
 *
 * Every figure is aggregated from the store event log. Nothing on this page is sampled,
 * modelled or filled in: if an event was not recorded, the number is absent and says so.
 * That constraint is the reason the previous mock-data dashboard was deleted, and it is
 * worth more here than anywhere else in the console — an owner makes staffing and
 * reordering decisions off these tiles.
 *
 * Chart choices, all deliberate: every plot is a single series, so each uses one hue and
 * needs no legend; magnitude is encoded by bar length against a shared scale; there is no
 * second y-axis anywhere. Values are labelled selectively rather than on every mark.
 */
const WINDOWS: Array<{ key: AnalyticsWindow; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

export default function InsightsPage() {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [window, setWindow] = useState<AnalyticsWindow>('today');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStores()
      .then((list) => {
        setStores(list);
        setStoreId((current) => current || list[0]?.id || '');
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : 'Could not load stores.')
      );
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchAnalytics(storeId, window));
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load insights.');
    } finally {
      setIsLoading(false);
    }
  }, [storeId, window]);

  useEffect(() => {
    void load();
  }, [load]);

  const analytics = data?.analytics ?? null;

  // "No events at all" is a different situation from "a quiet day", and the page has to
  // distinguish them or every tile reads as a business failure on day one.
  const hasAnyActivity = useMemo(
    () =>
      analytics !== null &&
      (analytics.sessionsStarted > 0 ||
        analytics.productsScanned > 0 ||
        analytics.revenue.ordersPlaced > 0),
    [analytics]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-ink">Store insights</h1>
        <p className="mt-1 text-sm text-muted">
          Counted from real shopping activity. Nothing on this page is estimated.
        </p>
      </div>

      {/* Filters in a single row above the charts, per the dashboard convention. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold text-ink"
        >
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name} — {store.address}
            </option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded-xl border border-border bg-surface">
          {WINDOWS.map((option) => (
            <button
              key={option.key}
              onClick={() => setWindow(option.key)}
              className={`px-3 py-2 text-xs font-extrabold transition ${
                window === option.key ? 'bg-primary text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => void load()}
          className="ml-auto rounded-xl border border-border bg-surface px-3 py-2 text-xs font-extrabold text-muted hover:text-ink"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-danger/40 bg-danger/5 p-5">
          <p className="text-sm font-semibold text-danger">{error}</p>
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-28 animate-pulse rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      )}

      {!isLoading && analytics && !hasAnyActivity && (
        <NoActivityYet dataSince={data?.data_since ?? null} />
      )}

      {!isLoading && analytics && hasAnyActivity && (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Products scanned"
              value={analytics.productsScanned.toLocaleString('en-IN')}
              sub={`${analytics.unitsSold.toLocaleString('en-IN')} units actually sold`}
            />
            <Stat
              label="Shopping sessions"
              value={analytics.sessionsStarted.toLocaleString('en-IN')}
              sub={
                analytics.conversionRatePct === null
                  ? 'no sessions yet'
                  : `${analytics.conversionRatePct}% reached checkout`
              }
            />
            <Stat
              label="Average shopping time"
              value={
                analytics.averageShoppingMinutes === null
                  ? '—'
                  : `${analytics.averageShoppingMinutes} min`
              }
              sub={
                analytics.completedSessionSampleSize === 0
                  ? 'no completed sessions yet'
                  : `median ${analytics.medianShoppingMinutes} min · ${analytics.completedSessionSampleSize} sessions`
              }
            />
            <Stat
              label="Revenue"
              value={formatRupees(analytics.revenue.grossPaise)}
              sub={
                analytics.revenue.averageOrderValuePaise === null
                  ? `${analytics.revenue.ordersPlaced} orders`
                  : `${analytics.revenue.ordersPlaced} orders · avg ${formatRupees(
                      analytics.revenue.averageOrderValuePaise
                    )}`
              }
            />
          </div>

          <div className="mb-8 grid gap-4 lg:grid-cols-3">
            <Panel
              title="Gross profit"
              note="Revenue minus the cost price already held against each product."
            >
              <p className="text-3xl font-extrabold text-ink">
                {formatRupees(analytics.revenue.grossProfitPaise)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {analytics.revenue.grossPaise > 0
                  ? `${Math.round(
                      (analytics.revenue.grossProfitPaise / analytics.revenue.grossPaise) * 1000
                    ) / 10}% margin on takings`
                  : 'no sales in this window'}
              </p>
            </Panel>

            <Panel
              title="SnapUp service charge"
              note="What SnapUp invoices for this window. Customer payments go directly to your account."
            >
              <p className="text-3xl font-extrabold text-ink">
                {formatRupees(analytics.revenue.platformFeePaise)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {analytics.revenue.ordersPlaced} orders in this window
              </p>
            </Panel>

            <Panel
              title="Busiest hour"
              note="When customers are actually in the shop — useful for staffing the exit."
            >
              <BusiestHour hourly={analytics.hourly} />
            </Panel>
          </div>

          <Section title="Peak hours">
            <HourlyChart hourly={analytics.hourly} />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Top products">
              {analytics.topProducts.length === 0 ? (
                <Empty message="No products sold or scanned in this window." />
              ) : (
                <RankedBars
                  rows={analytics.topProducts.slice(0, 20).map((product) => ({
                    key: product.productId,
                    label: product.name,
                    value: product.revenuePaise,
                    display: formatRupees(product.revenuePaise),
                    detail: `${product.unitsSold} sold · ${product.scans} scans`,
                  }))}
                />
              )}
            </Section>

            <Section
              title="Aisle traffic"
              note="Derived from where items were scanned. Falls back to product category where shelf locations are not mapped."
            >
              {analytics.aisleTraffic.length === 0 ? (
                <Empty message="No scans recorded in this window." />
              ) : (
                <RankedBars
                  rows={analytics.aisleTraffic.slice(0, 12).map((aisle) => ({
                    key: aisle.aisle,
                    label: aisle.aisle,
                    value: aisle.sessions,
                    display: `${aisle.sessions} shoppers`,
                    detail: `${aisle.scans} scans`,
                  }))}
                />
              )}
            </Section>
          </div>

          {window !== 'today' && analytics.daily.length > 0 && (
            <Section title="Daily revenue">
              <DailyChart daily={analytics.daily} />
            </Section>
          )}

          {analytics.missedScans.length > 0 && (
            <Section
              title="Missing from your catalogue"
              note="Barcodes customers scanned that returned nothing. Each one is a sale the app could not complete."
            >
              <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                {analytics.missedScans.map((miss) => (
                  <div
                    key={miss.barcode}
                    className="flex items-center justify-between border-b border-border px-5 py-3 last:border-b-0"
                  >
                    <span className="font-mono text-sm font-bold text-ink">{miss.barcode}</span>
                    <span className="text-xs text-muted">
                      {miss.attempts} {miss.attempts === 1 ? 'attempt' : 'attempts'} ·{' '}
                      {miss.sessions} {miss.sessions === 1 ? 'shopper' : 'shoppers'}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/products"
                className="mt-3 inline-block text-xs font-extrabold text-primary hover:underline"
              >
                Add these to the catalogue →
              </Link>
            </Section>
          )}

          <p className="mt-8 text-xs text-muted">
            {data?.data_since
              ? `Recording since ${new Date(data.data_since).toLocaleString('en-IN')}.`
              : 'No events recorded yet.'}{' '}
            &quot;Products scanned&quot; counts lookups that reached the server; repeat scans of
            the same item within five minutes are served from the phone&apos;s cache and are not
            counted twice.
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Charts. Single series throughout, so one hue and no legend — identity is    */
/* carried by the row label beside each bar rather than by colour.             */
/* -------------------------------------------------------------------------- */

function HourlyChart({ hourly }: { hourly: Array<{ hour: number; scans: number; sessionsStarted: number }> }) {
  // Fill the full 24 hours so the shape of the trading day is visible, including the
  // closed hours. A chart of only the hours that had traffic hides when the shop is dead.
  const byHour = new Map(hourly.map((bucket) => [bucket.hour, bucket]));
  const bars = Array.from({ length: 24 }, (_, hour) => byHour.get(hour)?.scans ?? 0);
  const peak = Math.max(...bars, 1);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex h-40 items-end gap-[2px]">
        {bars.map((scans, hour) => (
          <div key={hour} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-primary transition group-hover:opacity-80"
              style={{ height: `${Math.max((scans / peak) * 100, scans > 0 ? 3 : 0)}%` }}
            />
            {/* Hover detail rather than a label on all 24 bars. */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[10px] font-bold text-white group-hover:block">
              {formatHour(hour)} · {scans} scans
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-bold text-muted">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  );
}

function DailyChart({ daily }: { daily: Array<{ date: string; revenuePaise: number; ordersPlaced: number }> }) {
  const peak = Math.max(...daily.map((day) => day.revenuePaise), 1);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex h-40 items-end gap-1">
        {daily.map((day) => (
          <div key={day.date} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-primary transition group-hover:opacity-80"
              style={{
                height: `${Math.max((day.revenuePaise / peak) * 100, day.revenuePaise > 0 ? 3 : 0)}%`,
              }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[10px] font-bold text-white group-hover:block">
              {day.date} · {formatRupees(day.revenuePaise)} · {day.ordersPlaced} orders
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-bold text-muted">
        <span>{daily[0]?.date}</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

interface RankedRow {
  key: string;
  label: string;
  value: number;
  display: string;
  detail: string;
}

/**
 * Ranked horizontal bars. Values are labelled on every row here — unlike a time series,
 * this form is a table with a magnitude cue, and the number is the point of each row.
 */
function RankedBars({ rows }: { rows: RankedRow[] }) {
  const peak = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-bold text-ink">{row.label}</span>
              <span className="shrink-0 text-sm font-extrabold text-ink">{row.display}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max((row.value / peak) * 100, row.value > 0 ? 2 : 0)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] text-muted">{row.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BusiestHour({ hourly }: { hourly: Array<{ hour: number; scans: number }> }) {
  if (hourly.length === 0) return <p className="text-sm text-muted">No activity yet.</p>;

  const busiest = hourly.reduce((best, bucket) => (bucket.scans > best.scans ? bucket : best));
  if (busiest.scans === 0) return <p className="text-sm text-muted">No activity yet.</p>;

  return (
    <>
      <p className="text-3xl font-extrabold text-ink">{formatHour(busiest.hour)}</p>
      <p className="mt-1 text-xs text-muted">{busiest.scans} scans in that hour</p>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function NoActivityYet({ dataSince }: { dataSince: number | null }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8">
      <h2 className="text-lg font-extrabold text-ink">No shopping activity recorded yet</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        This page fills in on its own once customers start shopping — every entry, scan and
        order is recorded as it happens. It is deliberately blank rather than showing sample
        figures, so a number here always means a real one.
      </p>
      <p className="mt-3 text-xs text-muted">
        {dataSince
          ? `Recording since ${new Date(dataSince).toLocaleString('en-IN')}, with no activity in the selected window.`
          : 'Nothing has been recorded for this store yet.'}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{title}</p>
      <div className="mt-2">{children}</div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide text-muted">{title}</h2>
      {note && <p className="mb-3 max-w-2xl text-xs text-muted">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}
