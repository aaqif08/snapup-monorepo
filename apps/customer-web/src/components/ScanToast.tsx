'use client';

interface ScanToastProps {
  productName: string;
  priceLabel: string;
  onDismiss: () => void;
}

/**
 * Replaces the original ScannerScreen.tsx's Alert.alert(...) call — RN's Alert
 * has no web equivalent, so confirmation is shown as an inline toast instead.
 */
export default function ScanToast({ productName, priceLabel, onDismiss }: ScanToastProps) {
  return (
    <div className="toast-enter absolute inset-x-4 top-4 z-30 rounded-2xl bg-white p-4 shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-96 sm:-translate-x-1/2">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-white">
          ✓
        </span>
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-primary">Item Captured</p>
      </div>
      <p className="mb-1 font-extrabold text-ink">{productName}</p>
      <p className="mb-3 text-sm text-muted">{priceLabel}</p>
      <button
        onClick={onDismiss}
        className="w-full rounded-xl bg-ink py-2.5 text-sm font-extrabold text-white transition hover:opacity-90"
      >
        Continue Scanning
      </button>

      <style jsx>{`
        .toast-enter {
          animation: toast-slide-fade 260ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes toast-slide-fade {
          0% {
            opacity: 0;
            transform: translateY(-14px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
