/**
 * A content placeholder.
 *
 * ## Why a travelling band rather than a pulse
 *
 * A pulsing opacity fades the whole block in and out, which reads as something
 * malfunctioning — the page appears to breathe. A band of light moving across it has a
 * direction, and direction reads as "this is arriving". The placeholder's own contrast
 * stays constant, so the layout looks stable while it waits.
 *
 * ## Why it mirrors the real content's shape
 *
 * Skeletons that match the size and rhythm of what replaces them stop the page jumping
 * when the data lands. A generic grey box that is then replaced by a taller card moves
 * everything below it, and on a phone that means the thing someone was about to tap
 * shifts under their thumb.
 *
 * The band is hidden from assistive technology entirely: a screen reader should hear the
 * content or hear nothing, never a description of a loading rectangle.
 */
export default function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded-2xl bg-surface ${className}`}
    >
      {/* `via-` carries the light. In dark mode the same white at low alpha reads as a
          highlight rather than a smear, which is why this is an alpha gradient and not a
          named colour. */}
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-ink/[0.06] to-transparent" />
    </div>
  );
}

/**
 * The home screen while the shop directory loads.
 *
 * Laid out to the same rhythm as the real thing — a banner, a location block, then a row
 * of shop cards — so nothing moves when the data arrives.
 */
export function HomeSkeleton() {
  return (
    <div className="animate-fade-in-up px-4 pt-2" role="status" aria-label="Loading shops">
      <Skeleton className="aspect-[2.35/1] w-full" />

      <div className="flex justify-center gap-1.5 pt-2.5">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-1.5 w-1.5 rounded-full" />
        ))}
      </div>

      <Skeleton className="mt-5 h-4 w-28 rounded-lg" />
      <Skeleton className="mt-2 h-3 w-52 rounded-lg" />
      <Skeleton className="mt-4 h-12 w-full" />

      <div className="mt-6 flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-36 w-36 shrink-0" />
        ))}
      </div>
    </div>
  );
}
