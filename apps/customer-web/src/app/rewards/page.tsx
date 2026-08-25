'use client';

import ScreenHeader from '@/components/ScreenHeader';

/**
 * Rewards — SnapCount.
 *
 * The count is hard-zero rather than fetched, because there is no loyalty ledger behind it
 * yet. Showing a fabricated balance is the one thing this screen must not do: a number a
 * customer believes they have earned and cannot spend is worse than an honest zero.
 *
 * The rule — earning starts from the third shop — comes from the design.
 */
export default function RewardsPage() {
  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="Rewards" icon={<RewardsMark />} />

      <div className="flex flex-col items-center px-6 pt-16 text-center">
        <BagIcon />

        <p className="mt-8 text-base font-bold text-muted">
          SnapCount <span className="ml-1 text-lg font-extrabold text-ink">0</span>
        </p>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
          Your SnapCount starts from your 3rd shopping trip.
        </p>

        <div className="mt-10 w-full rounded-2xl border border-border bg-surface p-4 text-left">
          <p className="text-sm font-extrabold text-ink">How it works</p>
          <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
            <li>1. Scan and pay through SnapUp at any participating shop.</li>
            <li>2. From your third completed shop, each one earns SnapCount.</li>
            <li>3. Spend it on offers as they appear in the Offers tab.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function RewardsMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5l2.1 1.6 2.6-.3 1 2.4 2.3 1.2-.6 2.6 1.6 2.1-1.6 2.1.6 2.6-2.3 1.2-1 2.4-2.6-.3L12 21.5l-2.1-1.6-2.6.3-1-2.4-2.3-1.2.6-2.6L3 12l1.6-2.1-.6-2.6 2.3-1.2 1-2.4 2.6.3z" />
      <path d="M9.5 14.5l5-5" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 100 110" className="h-28 w-auto text-primary" aria-hidden>
      <path
        d="M18 38h64l-4 60a8 8 0 0 1-8 7.4H30a8 8 0 0 1-8-7.4z"
        className="fill-current"
      />
      <path
        d="M34 38V26a16 16 0 0 1 32 0v12"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="36" cy="50" r="3.4" className="fill-surface" />
      <circle cx="64" cy="50" r="3.4" className="fill-surface" />
      <path d="M30 68h34v8H44v10h-14z" className="fill-surface" />
    </svg>
  );
}
