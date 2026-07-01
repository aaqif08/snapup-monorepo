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
    <div className="fixed inset-x-4 bottom-24 z-30 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-96 sm:-translate-x-1/2">
      <p className="text-sm font-semibold text-white">
        Removed <span className="font-extrabold">{itemName}</span>
      </p>
      <button onClick={onUndo} className="flex-shrink-0 text-sm font-extrabold text-primary">
        UNDO
      </button>
    </div>
  );
}
