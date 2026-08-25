'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ThemeToggle from '@snapup/ui/ThemeToggle';
import { fetchNearbyStores, type NearbyStore } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';

const DEFAULT_RADIUS_KM = 5;

/**
 * The home screen.
 *
 * Everything above "Nearby Shops" is orientation — where am I, what is on offer — and the
 * shop list is the only part that leads anywhere. That ordering is the design's, and it is
 * right for a shopper standing outside a supermarket deciding whether this app applies
 * here.
 */
export default function HomeContent() {
  const user = useAuthStore((state) => state.user);

  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [located, setLocated] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async (coords?: { latitude: number; longitude: number }) => {
    setIsLoading(true);
    try {
      const result = await fetchNearbyStores(coords, coords ? DEFAULT_RADIUS_KM : undefined);
      // Widen rather than show an empty list: "no SnapUp store within 5 km" is almost
      // always less useful than the nearest one, however far it is.
      const widened = result.stores.length === 0 && coords ? await fetchNearbyStores(coords) : null;
      setStores(widened?.stores ?? result.stores);
      setLocated(result.located);
      setLoadError(null);
    } catch {
      setLoadError('Could not load nearby shops. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        void load({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      // Declining is a normal answer, not an error worth a dialog. The unordered list is
      // still perfectly usable.
      () => setLocating(false),
      { timeout: 8000 }
    );
  }

  const filtered = query.trim()
    ? stores.filter((store) =>
        `${store.name} ${store.address}`.toLowerCase().includes(query.trim().toLowerCase())
      )
    : stores;

  return (
    <div className="mx-auto max-w-lg pb-24">
      {/* ---- Brand bar ---- */}
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <Image src="/logo-mark.png" alt="" width={32} height={32} className="h-8 w-auto" priority />
          <span className="text-xl font-extrabold tracking-tight text-ink">SnapUp</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            href="/account"
            aria-label="Your account"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-bg text-muted transition-colors hover:text-ink"
          >
            {user?.name ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-onPrimary">
                {user.name.trim()[0]?.toUpperCase()}
              </span>
            ) : (
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
                <circle cx="12" cy="12" r="11" fillOpacity="0.12" />
                <circle cx="12" cy="9.5" r="3.4" />
                <path d="M5.6 19.2a6.8 6.8 0 0 1 12.8 0A11 11 0 0 1 12 21a11 11 0 0 1-6.4-1.8z" />
              </svg>
            )}
          </Link>
        </div>
      </header>

      <PromoCarousel />

      {/* ---- Where you are ---- */}
      <section className="px-4 pt-4">
        <button
          type="button"
          onClick={useMyLocation}
          className="flex items-center gap-1 text-base font-bold text-violet"
        >
          {located ? 'Near you' : 'Set your location'}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <p className="mt-0.5 truncate text-sm text-muted">
          {located
            ? `${filtered.length} shop${filtered.length === 1 ? '' : 's'} sorted by distance`
            : 'Share your location to sort shops by distance'}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-12 flex-1 items-center gap-2 rounded-2xl bg-bg px-4">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shops"
              aria-label="Search shops"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
            />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            aria-label="Use my current location"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bg text-ink transition-colors hover:bg-border disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className={`h-5 w-5 ${locating ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        </div>
      </section>

      {/* ---- Quick actions ---- */}
      <nav aria-label="Shortcuts" className="grid grid-cols-4 gap-2 px-4 pt-5">
        <Shortcut href="/bills" label="Recent" tone="bg-sky-100 text-sky-600" icon={<ClockIcon />} />
        <Shortcut href="/bills" label="Favourite" tone="bg-rose-100 text-rose-500" icon={<HeartIcon />} />
        <Shortcut href="/offers" label="Offers" tone="bg-violet/15 text-violet" icon={<TagIcon />} />
        <Shortcut href="/rewards" label="Rewards" tone="bg-amber-100 text-amber-600" icon={<GiftIcon />} />
      </nav>

      {/* ---- Scan promo ---- */}
      <section className="px-4 pt-5">
        <Link
          href="/scan"
          className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-amber-200 via-amber-100 to-orange-200 px-4 py-4 transition-transform active:scale-[0.99]"
        >
          <div className="min-w-0">
            <p className="text-sm font-extrabold uppercase tracking-wide text-amber-900">
              Scan &amp; pay instantly
            </p>
            <p className="mt-0.5 text-xs font-medium text-amber-800">
              Skip the queue. Scan products. Pay in the app.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[11px] font-extrabold text-ink shadow-card">
            Start
          </span>
        </Link>
      </section>

      {/* ---- Nearby shops ---- */}
      <section className="pt-6">
        <h2 className="px-4 pb-3 text-base font-extrabold text-ink">Nearby Shops</h2>

        {isLoading ? (
          <div className="flex gap-3 overflow-hidden px-4">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-36 w-36 shrink-0 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        ) : loadError ? (
          <div className="mx-4 rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="text-sm font-semibold text-danger">{loadError}</p>
            <button
              onClick={() => void load()}
              className="mt-3 rounded-xl border border-border px-4 py-2 text-xs font-extrabold text-ink"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mx-4 rounded-2xl border border-border bg-surface px-5 py-10 text-center">
            <p className="text-sm font-bold text-ink">
              {query.trim() ? 'No shops match that' : 'No shops available yet'}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
              {query.trim()
                ? 'Try a different name or area.'
                : 'SnapUp is not live in any nearby shop yet. Check back soon.'}
            </p>
          </div>
        ) : (
          // Horizontal scroll with snap, so a half-visible card always settles cleanly.
          <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filtered.map((store) => (
              <li key={store.id} className="snap-start">
                <StoreCard store={store} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StoreCard({ store }: { store: NearbyStore }) {
  return (
    <Link
      href={`/store/${store.id}`}
      className="flex h-full w-36 flex-col rounded-2xl border border-border bg-surface p-3 transition-transform active:scale-[0.98]"
    >
      <div className="flex h-16 items-center justify-center rounded-xl bg-bg">
        <span className="text-lg font-extrabold tracking-tight text-ink">
          {initials(store.name)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] font-bold leading-snug text-ink">{store.name}</p>

      <div className="mt-auto flex items-center gap-2 pt-2 text-[11px] font-semibold text-muted">
        <span className="flex items-center gap-0.5">
          <span className="text-amber-500" aria-hidden>★</span>
          4.5
        </span>
        {/* Only shown when a distance actually exists. An unsurveyed branch has none, and
            inventing one would put a number on screen nobody measured. */}
        {store.distanceKm !== undefined && (
          <span className="flex items-center gap-0.5">
            <span className="text-danger" aria-hidden>◉</span>
            {formatDistance(store.distanceKm)}
          </span>
        )}
        {!store.isOpen && <span className="font-extrabold text-danger">Closed</span>}
      </div>
    </Link>
  );
}

function Shortcut({
  href,
  label,
  icon,
  tone,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tone}`}>
        {icon}
      </span>
      <span className="text-[11px] font-bold text-ink">{label}</span>
    </Link>
  );
}

/**
 * The promo strip.
 *
 * Dots only — no auto-advance. A banner that moves on its own steals the tap of anyone
 * reaching for the card underneath it, and this sits directly above the location control
 * people actually came for.
 */
function PromoCarousel() {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const slides = [
    { title: 'Skip the checkout queue', body: 'Scan as you shop and pay from your phone.', from: 'from-violet', to: 'to-indigo-500' },
    { title: 'Your bills, kept', body: 'Every GST invoice saved in My Bills.', from: 'from-emerald-500', to: 'to-teal-600' },
    { title: 'SnapCount rewards', body: 'Earn from your third shop onwards.', from: 'from-amber-500', to: 'to-orange-500' },
  ];

  function onScroll() {
    const element = track.current;
    if (!element) return;
    setIndex(Math.round(element.scrollLeft / element.clientWidth));
  }

  return (
    <section className="pt-2">
      <div
        ref={track}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide) => (
          <div
            key={slide.title}
            className={`w-full shrink-0 snap-center rounded-2xl bg-gradient-to-br ${slide.from} ${slide.to} p-5 text-white`}
          >
            <p className="text-lg font-extrabold leading-tight">{slide.title}</p>
            <p className="mt-1 text-sm font-medium text-white/85">{slide.body}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-1.5 pt-2.5" aria-hidden>
        {slides.map((slide, position) => (
          <span
            key={slide.title}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              position === index ? 'w-5 bg-ink' : 'w-1.5 bg-border'
            }`}
          />
        ))}
      </div>
    </section>
  );
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? '?').toUpperCase() + (words[1]?.[0] ?? '').toUpperCase();
}

/** Metres below a kilometre, matching the design's "150m" / "300m". */
function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M12 20.5l-1.4-1.3C5.9 15 3 12.4 3 9.2 3 6.7 5 4.8 7.5 4.8c1.4 0 2.8.7 3.6 1.8l.9 1.2.9-1.2c.8-1.1 2.2-1.8 3.6-1.8C19 4.8 21 6.7 21 9.2c0 3.2-2.9 5.8-7.6 10z" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.5 13.5l-7 7-10-10V3.5h7z" />
      <circle cx="7.8" cy="7.8" r="1.4" fill="currentColor" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 11h17v9.5h-17zM2.5 7h19v4h-19zM12 7v13.5" />
      <path d="M12 7S10.5 3 8.2 3a2.1 2.1 0 0 0 0 4zM12 7s1.5-4 3.8-4a2.1 2.1 0 0 1 0 4z" />
    </svg>
  );
}
