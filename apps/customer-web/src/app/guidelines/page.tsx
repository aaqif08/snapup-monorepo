'use client';

import ScreenHeader from '@/components/ScreenHeader';

/**
 * Scanning guidelines.
 *
 * Reached from the small "i" beside the viewfinder. The design puts that link on the scan
 * screen and gives it somewhere to go, and it earns its place during a pilot: almost every
 * failed scan is one of a handful of physical causes, and a customer who can self-diagnose
 * does not queue at the counter to ask.
 *
 * The last two entries are the ones staff will otherwise field all day. They describe how
 * the system actually behaves — the exit code, and the fact that presence is re-checked on
 * every request — rather than reassuring anyone that things work.
 */
export default function GuidelinesPage() {
  return (
    <div className="mx-auto max-w-lg pb-10">
      <ScreenHeader title="Guidelines" icon={<InfoMark />} />

      <div className="px-4 pt-2">
        <p className="text-sm leading-relaxed text-muted">
          A few things that make scanning reliable, and what to do when it is not.
        </p>

        <div className="mt-5 space-y-3">
          {RULES.map((rule) => (
            <section key={rule.title} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-primary"
                  aria-hidden
                >
                  {rule.icon}
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold text-ink">{rule.title}</h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{rule.body}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-6 rounded-2xl bg-tint/60 px-4 py-3 text-[13px] leading-relaxed text-ink">
          Still stuck? Any member of staff can add an item by hand and settle your basket at
          the counter. Nothing is lost — your cart stays exactly as it is.
        </p>
      </div>
    </div>
  );
}

const RULES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'Fill the frame with the barcode',
    body: 'Hold the phone roughly a hand-span away so the bars sit between the four corner marks. Too close is a more common failure than too far.',
    icon: <Glyph d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" />,
  },
  {
    title: 'Keep it flat and steady',
    body: 'A barcode curved around a bottle or crumpled on a packet breaks the bar widths the reader measures. Flatten the label with a thumb and pause for a moment.',
    icon: <Glyph d="M4 6v12M8 6v12M12 6v12M16 6v12M20 6v12" />,
  },
  {
    title: 'Avoid glare',
    body: 'Shiny wrappers under a strip light wash the bars out. Tilt the packet a few degrees rather than moving the phone, or step out of the direct light.',
    icon: <Glyph d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" extra={<circle cx="12" cy="12" r="3.2" />} />,
  },
  {
    title: 'Loose produce has no barcode',
    body: 'Weighed items — vegetables, fruit, anything from the deli counter — carry a printed sticker from the scale. Scan that sticker, not the packaging.',
    icon: <Glyph d="M12 20a6 6 0 006-6c0-3.5-3-7-6-8-3 1-6 4.5-6 8a6 6 0 006 6z" extra={<path d="M12 6V3.5" />} />,
  },
  {
    title: 'The session ends when you leave',
    body: 'Your basket is tied to being in the shop, and presence is re-checked on every scan. If you step outside or drop off the shop Wi-Fi the session closes and you scan the entrance code again to resume.',
    icon: <Glyph d="M12 7v5l3 2" extra={<circle cx="12" cy="12" r="8" />} />,
  },
  {
    title: 'Show your code at the exit',
    body: 'After paying you are given a six-character code. A member of staff matches it against the payment in the shop’s own app before the gate opens — so keep the screen up until they have.',
    icon: <Glyph d="M8 12h8M8 9h5M8 15h3" extra={<rect x="4" y="4" width="16" height="16" rx="3" />} />,
  },
];

function Glyph({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {extra}
      <path d={d} />
    </svg>
  );
}

function InfoMark() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary text-[11px] font-extrabold text-primary">
      i
    </span>
  );
}
