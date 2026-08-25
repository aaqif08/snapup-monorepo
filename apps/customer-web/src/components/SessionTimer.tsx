'use client';

import { useEffect, useState } from 'react';

/**
 * The shopping-session countdown.
 *
 * The design gives this three distinct treatments and they carry real meaning, so they are
 * not decoration:
 *
 *   - **black `30:00`** — plenty of time, say nothing more
 *   - **amber `15:00` + "15 mins left"** — a nudge, because a shopper who runs out mid-aisle
 *     has to walk back to the entrance and rescan
 *   - **red `0:00` + "Session Expired, Scan again to continue"** — the session is gone
 *
 * It counts down from a server-supplied expiry rather than from a local duration. The
 * session's real lifetime lives in the signed token; a timer that started its own clock
 * would drift from it, and the failure mode is the worst kind — a customer watching a
 * timer that says 4:00 while the API has already refused them.
 */

const WARNING_AT_SECONDS = 15 * 60;

export default function SessionTimer({
  expiresAt,
  onExpire,
}: {
  /** Epoch milliseconds, from `session/start`. */
  expiresAt: number | null;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt));

  useEffect(() => {
    if (expiresAt === null) return;

    setRemaining(secondsUntil(expiresAt));
    const id = window.setInterval(() => {
      const next = secondsUntil(expiresAt);
      setRemaining(next);
      if (next <= 0) {
        window.clearInterval(id);
        onExpire?.();
      }
    }, 1000);

    return () => window.clearInterval(id);
    // `onExpire` deliberately excluded: a caller passing an inline arrow would otherwise
    // tear down and restart the interval on every render, and the clock would never tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  if (expiresAt === null) return null;

  const expired = remaining <= 0;
  const warning = !expired && remaining <= WARNING_AT_SECONDS;

  return (
    <div className="flex flex-col items-center gap-2">
      <p
        // `tabular-nums` stops the width jittering as digits change, which on a 1 Hz
        // countdown is otherwise a constant twitch in the middle of the screen.
        className={`font-mono text-2xl font-extrabold tabular-nums ${
          expired ? 'text-danger' : warning ? 'text-ink' : 'text-ink'
        }`}
        // The number is the status; announce it only when it changes meaningfully rather
        // than every second, which would make a screen reader unusable.
        aria-live={expired || warning ? 'polite' : 'off'}
      >
        {format(remaining)}
      </p>

      {expired ? (
        <Pill tone="danger">
          Session <strong className="font-extrabold">Expired</strong>, Scan again to continue
        </Pill>
      ) : warning ? (
        <Pill tone="warning">{Math.ceil(remaining / 60)} mins left</Pill>
      ) : null}
    </div>
  );
}

/** The rounded status pill the design uses for every transient message on the scan screen. */
export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const style = {
    neutral: 'bg-surface text-ink border-border',
    success: 'bg-surface text-ink border-border',
    warning: 'bg-warning/10 text-warning border-warning/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-4 py-1.5 text-[13px] font-semibold shadow-card ${style}`}
    >
      {children}
    </span>
  );
}

function secondsUntil(expiresAt: number | null): number {
  if (expiresAt === null) return 0;
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

function format(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
