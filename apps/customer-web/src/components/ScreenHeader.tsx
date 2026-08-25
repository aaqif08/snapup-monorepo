'use client';

import { useRouter } from 'next/navigation';

/**
 * The back-arrow + centred-title header every inner screen shares.
 *
 * The title is optically centred by giving the back button and the trailing slot equal
 * fixed widths, rather than by absolute-positioning the title. That way a long title
 * truncates instead of sliding under the arrow.
 */
export default function ScreenHeader({
  title,
  icon,
  trailing,
  onBack,
}: {
  title: string;
  /** Small mark shown left of the title, as the design does on Cart, Bills and Offers. */
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();

  return (
    <header className="flex items-center gap-2 px-4 pb-2 pt-4">
      <button
        type="button"
        aria-label="Go back"
        onClick={() => (onBack ? onBack() : router.back())}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-ink transition-colors duration-200 hover:bg-border"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        {icon}
        <h1 className="truncate text-lg font-bold text-ink">{title}</h1>
      </div>

      {/* Mirrors the back button's width so the title sits centred with or without a
          trailing action. */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-end">{trailing}</div>
    </header>
  );
}
