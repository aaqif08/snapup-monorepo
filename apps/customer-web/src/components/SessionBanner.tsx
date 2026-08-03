'use client';

import type { SessionStatus } from '@/store/useSessionStore';

interface SessionBannerProps {
  status: SessionStatus;
  onRestart: () => void;
}

/**
 * Explains why database access stopped.
 *
 * Requirement 1 means a customer's session can die mid-trip through no fault of their
 * own (they wandered to the car park). Without an explanation that reads as a security
 * feature rather than a bug, the POC looks broken to the people evaluating it.
 */
const COPY: Record<Exclude<SessionStatus, 'active'>, { title: string; body: string; cta: string }> = {
  idle: {
    title: 'Scan to start shopping',
    body: 'Connect to the store Wi-Fi and scan the entrance code to unlock the product catalogue.',
    cta: 'Scan entrance code',
  },
  presence_lost: {
    title: 'You’ve left the store',
    body: 'Snap Up only works inside a participating store. Your shopping session ended and product data is no longer available. Reconnect to the store Wi-Fi and scan the entrance code to resume.',
    cta: 'Scan entrance code',
  },
  expired: {
    title: 'Session expired',
    body: 'Shopping sessions last 30 minutes. Scan the entrance code again to carry on — your cart has been kept.',
    cta: 'Resume shopping',
  },
  ended: {
    title: 'Session ended',
    body: 'This shopping session is closed. Scan the entrance code to start a new one.',
    cta: 'Scan entrance code',
  },
};

export default function SessionBanner({ status, onRestart }: SessionBannerProps) {
  if (status === 'active') return null;
  const copy = COPY[status];

  return (
    <div className="animate-fade-in-up rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-2xl"
        aria-hidden
      >
        {status === 'idle' ? '🛒' : status === 'expired' ? '⏱️' : '📶'}
      </div>
      <h2 className="mb-2 text-xl font-extrabold text-ink">{copy.title}</h2>
      <p className="mb-6 text-sm leading-relaxed text-muted">{copy.body}</p>
      <button
        onClick={onRestart}
        className="w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-onPrimary transition duration-200 hover:bg-primaryDark active:scale-[0.99]"
      >
        {copy.cta}
      </button>
    </div>
  );
}
