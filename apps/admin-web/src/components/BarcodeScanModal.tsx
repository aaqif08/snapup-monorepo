'use client';

import { useEffect, useState } from 'react';
import BarcodeScanner from '@snapup/ui/BarcodeScanner';

/** Same rule the customer lookup route enforces — EAN/UPC are digits only. */
const BARCODE_PATTERN = /^\d{6,14}$/;

interface BarcodeScanModalProps {
  title: string;
  /** Shown under the title — used to explain what happens after a successful scan. */
  hint: string;
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

/**
 * Camera capture for the business console.
 *
 * Two things this deliberately does not assume:
 *
 * 1. **That a camera exists.** `getUserMedia` is only exposed in a secure context, so a
 *    manager opening the console from their phone at `http://192.168.x.x:3001` gets
 *    nothing — and a shop's back-office desktop may have no camera at all. Manual entry is
 *    therefore always available, not a hidden fallback behind an error state.
 * 2. **That a detected barcode is usable.** The scanner also reads QR codes and Data
 *    Matrix, so a shelf label or a supplier's QR sticker will happily decode into
 *    something that is not an EAN/UPC. Those are rejected here with the reason shown,
 *    rather than being written into the form for the server to refuse later.
 */
export default function BarcodeScanModal({
  title,
  hint,
  onDetected,
  onClose,
}: BarcodeScanModalProps) {
  const [manualEntry, setManualEntry] = useState('');
  const [rejected, setRejected] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(true);

  // Esc closes, since this covers the whole screen and the cancel button can be below the
  // fold on a short viewport.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const accept = (barcode: string) => {
    const trimmed = barcode.trim();
    if (!BARCODE_PATTERN.test(trimmed)) {
      setRejected(trimmed);
      return;
    }
    setRejected(null);
    // Tearing the camera down before handing the value back stops the torch/preview from
    // staying live behind the form that opens next.
    setIsCameraOpen(false);
    onDetected(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="my-8 w-full max-w-md animate-fade-in-up rounded-t-3xl border border-border bg-surface p-6 shadow-pop sm:rounded-3xl">
        <h2 className="text-lg font-extrabold text-ink">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>

        <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-2xl bg-black">
          {isCameraOpen && <BarcodeScanner isActive onScan={accept} />}
          {/* Viewfinder: the decoder crops to the centre of the frame, so the guide has to
              show where that actually is or people aim at the wrong place. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[60%] w-[60%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>

        {rejected !== null && (
          <div className="mt-3 rounded-xl bg-warning/10 px-3 py-2.5">
            <p className="text-[11px] font-bold leading-relaxed text-warning">
              Read <span className="font-mono">{rejected.slice(0, 40)}</span>, which is not a
              product barcode. Point the camera at the EAN/UPC barcode — 6 to 14 digits — not
              at a QR code or shelf label.
            </p>
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-xs font-bold text-muted">
            Or type the barcode
          </label>
          <div className="flex gap-2">
            <input
              value={manualEntry}
              onChange={(event) => setManualEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') accept(manualEntry);
              }}
              inputMode="numeric"
              placeholder="890123456001"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 font-mono text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary"
            />
            <button
              type="button"
              onClick={() => accept(manualEntry)}
              disabled={manualEntry.trim().length === 0}
              className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-onPrimary hover:opacity-90 disabled:opacity-40"
            >
              Use
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            The camera needs HTTPS or localhost. If the preview above stays black, the
            console is being served over plain HTTP — type the barcode instead.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-border py-3 text-sm font-extrabold text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
