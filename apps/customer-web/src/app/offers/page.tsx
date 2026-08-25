'use client';

import ScreenHeader from '@/components/ScreenHeader';

/**
 * Offers.
 *
 * Empty, and honest about it. There is no promotions engine yet, so this shows the design's
 * empty state rather than inventing sample offers — a mocked-up discount that vanishes at
 * the till is worse than a screen that says there is nothing on.
 */
export default function OffersPage() {
  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="Offers" icon={<OffersMark />} />

      <div className="flex flex-col items-center px-6 pt-16 text-center">
        <SadPhone />
        <p className="mt-8 text-base font-bold text-muted">
          Sorry, currently no offers available!
        </p>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
          When a shop runs a promotion it will appear here, and any discount is applied
          automatically at checkout.
        </p>
      </div>
    </div>
  );
}

function OffersMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5l2.1 1.6 2.6-.3 1 2.4 2.3 1.2-.6 2.6 1.6 2.1-1.6 2.1.6 2.6-2.3 1.2-1 2.4-2.6-.3L12 21.5l-2.1-1.6-2.6.3-1-2.4-2.3-1.2.6-2.6L3 12l1.6-2.1-.6-2.6 2.3-1.2 1-2.4 2.6.3z" />
      <path d="M9.5 14.5l5-5M9.6 9.6h.01M14.4 14.4h.01" />
    </svg>
  );
}

/** The design's mascot. Inline SVG so it follows the theme instead of being a flat PNG. */
function SadPhone() {
  return (
    <svg viewBox="0 0 120 160" className="h-40 w-auto" aria-hidden>
      <g className="text-primary" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round">
        <rect x="30" y="18" width="60" height="100" rx="10" className="fill-primary/25" />
        <path d="M52 26h16" />
        <circle cx="48" cy="58" r="3" className="fill-current" stroke="none" />
        <circle cx="72" cy="58" r="3" className="fill-current" stroke="none" />
        <path d="M48 82q12-10 24 0" />
        <path d="M30 70q-14-4-16-18M90 70q14 6 12 20" />
        <path d="M46 118v26M74 118v26" />
        <path d="M38 146h16M66 146h16" />
      </g>
    </svg>
  );
}
