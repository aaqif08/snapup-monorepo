'use client';

import { useEffect } from 'react';

interface UndoToastProps {
  itemName: string;
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
}

/**
 * Shown for a few seconds after a cart item is removed. Removal itself is
 * instant and has no confirmation dialog (per spec — confirm dialogs on every
 * removal are friction modern food/retail apps avoid); this toast is the
 * safety net instead.
 */
export default function UndoToast({ itemName, onUndo, onExpire, durationMs = 4000 }: UndoToastProps) {
  useEffect(() => {
    const timer = setTimeout(onExpire, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-30 flex animate-fade-in-up items-center justify-between gap-3 rounded-2xl border border-border bg-accent px-4 py-3 shadow-pop sm:inset-x-auto sm:left-1/2 sm:w-96 sm:-translate-x-1/2"
    >
      <p className="text-sm font-semibold text-onAccent">
        Removed <span className="font-extrabold">{itemName}</span>
      </p>
      <button
        onClick={onUndo}
        className="flex-shrink-0 rounded-lg px-2 py-1 text-sm font-extrabold text-primary transition-colors duration-200 hover:bg-primary/10"
      >
        UNDO
      </button>
    </div>
  );
}
