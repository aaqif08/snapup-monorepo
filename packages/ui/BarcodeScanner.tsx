'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Camera barcode scanner, shared by both apps.
 *
 * Originally lived in customer-web, where a shopper scans items into their basket. The
 * business console needs the identical capability pointed the other way — a manager
 * scanning stock into the catalogue — and the tuning below (crop region, decode size, tick
 * interval) was arrived at against real barcodes, so it is worth having exactly one copy
 * of rather than two that quietly drift apart.
 *
 * Requires a **secure context**: browsers only expose `getUserMedia` over HTTPS or on
 * localhost. Opening the console from a phone at `http://192.168.x.x:3001` gives no camera
 * at all, which is why every caller must keep a manual-entry path available.
 */
/**
 * Why the camera did not open. Each maps to a different thing the person holding the
 * phone has to do, which is the entire reason this is an enumeration and not a boolean.
 */
export type CameraFault =
  /** Page served over plain HTTP from something other than localhost. */
  | 'insecure_context'
  /** Browser has no `getUserMedia` at all. */
  | 'unsupported'
  /** The permission prompt was dismissed or the site was previously blocked. */
  | 'permission_denied'
  /** No camera attached — the usual answer on a desktop. */
  | 'no_camera'
  /** A camera exists but another application holds it. */
  | 'camera_busy'
  | 'unknown';

interface BarcodeScannerProps {
  isActive: boolean;
  onScan: (barcode: string) => void;
  /**
   * Told when the camera cannot start, so a caller can offer its own way forward —
   * typically manual entry. The component always renders its own explanation regardless;
   * this exists so the surrounding screen can react, not so it can stay silent.
   */
  onError?: (fault: CameraFault, detail: string) => void;
}

/**
 * Turns a `getUserMedia` rejection into one of the faults above.
 *
 * The DOMException names are the contract here, not the messages, which differ per
 * browser and are localised.
 */
function classify(error: unknown): CameraFault {
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'camera_busy';
  return 'unknown';
}

// Suppress the zxing "already playing" noise if it ever gets imported elsewhere
if (typeof window !== 'undefined') {
  const _warn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('already playing')) return;
    _warn(...args);
  };
}

export default function BarcodeScanner({ isActive, onScan, onError }: BarcodeScannerProps) {
  const [fault, setFault] = useState<CameraFault | null>(null);
  /**
   * Bumped by the retry button, and in the effect's dependencies.
   *
   * Without it a refused permission was permanent for the life of the page: the effect
   * ran once on mount, and someone who allowed the camera afterwards in the address bar
   * had no way to tell the component to look again short of a reload.
   */
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScanRef = useRef(onScan);
  const isActiveRef = useRef(isActive);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep refs in sync without restarting the scanner
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    let stopped = false;

    /** Records the fault for the panel below and tells the caller, once. */
    function report(kind: CameraFault, detail: string) {
      if (stopped) return;
      console.error(`[Scanner] camera unavailable (${kind}):`, detail);
      setFault(kind);
      onErrorRef.current?.(kind, detail);
    }

    setFault(null);

    async function start() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      // Checked before asking, because the two commonest failures throw uselessly.
      // Browsers expose `getUserMedia` only in a secure context, so a phone opening
      // `http://192.168.x.x:3000` finds `navigator.mediaDevices` undefined and the call
      // dies as `Cannot read properties of undefined` — which tells the shopper nothing
      // and sends whoever is debugging it hunting through the decode path instead of at
      // the URL. That is the single most likely reason this screen shows no picture
      // during a pilot, so it gets named precisely.
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        report('insecure_context', 'Page is not a secure context; getUserMedia is unavailable.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        report('unsupported', 'This browser exposes no getUserMedia.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        // `facingMode` is `ideal`, not `exact`, so a device with only a front camera
        // still gets one rather than an OverconstrainedError.
        report(classify(err), err instanceof Error ? err.message : String(err));
        return;
      }

      if (stopped) return;

      const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

      if (hasBarcodeDetector) {
        // @ts-ignore
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'qr_code', 'data_matrix', 'itf'],
        });

        let tickCount = 0;
        const tick = async () => {
          if (stopped) return;
          tickCount++;
          if (isActiveRef.current && video.readyState === video.HAVE_ENOUGH_DATA) {
            try {
              // @ts-ignore
              const barcodes: any[] = await detector.detect(video);
              if (barcodes.length > 0) {
                if (isActiveRef.current) {
                  onScanRef.current(barcodes[0].rawValue);
                }
              }
            } catch {
              // detect() can throw on certain frames
            }
          }
          rafRef.current = requestAnimationFrame(() => { setTimeout(tick, 150); });
        };
        tick();
      } else {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        let ZXing: typeof import('@zxing/library') | null = null;
        let reader: any = null;
        try {
          ZXing = await import('@zxing/library');
          reader = new ZXing.BrowserMultiFormatReader();
        } catch (err) {
          report('unknown', `Barcode decoder failed to load: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        let tickCount = 0;
        const tick = async () => {
          if (stopped) return;
          tickCount++;
          if (isActiveRef.current && video.readyState === video.HAVE_ENOUGH_DATA) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            // Crop to a centered square region (60% of the shorter dimension).
            // This mimics a scan viewfinder and dramatically improves detection
            // because ZXing doesn't have to search a giant 1280px frame.
            const cropSize = Math.floor(Math.min(vw, vh) * 0.6);
            const cropX = Math.floor((vw - cropSize) / 2);
            const cropY = Math.floor((vh - cropSize) / 2);

            // Decode at a fixed 400px — large enough for ZXing, small enough to be fast
            const decodeSize = 400;
            canvas.width = decodeSize;
            canvas.height = decodeSize;
            ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, decodeSize, decodeSize);

            try {
              const imageData = ctx.getImageData(0, 0, decodeSize, decodeSize);
              // getImageData returns RGBA (4 bytes/pixel).
              // ZXing's RGBLuminanceSource expects RGB (3 bytes/pixel) — strip alpha.
              const rgba = imageData.data;
              const rgb = new Uint8ClampedArray(decodeSize * decodeSize * 3);
              for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
                rgb[j]     = rgba[i];
                rgb[j + 1] = rgba[i + 1];
                rgb[j + 2] = rgba[i + 2];
              }
              const luminance = new ZXing!.RGBLuminanceSource(rgb, decodeSize, decodeSize);
              const binary = new ZXing!.BinaryBitmap(new ZXing!.HybridBinarizer(luminance));
              const result = reader.decodeBitmap(binary);
              if (result && isActiveRef.current) {
                console.log('[Scanner] BARCODE DETECTED:', result.getText());
                onScanRef.current(result.getText());
              }
            } catch {
              // NotFoundException on frames with no barcode — expected and silent
            }
          }
          rafRef.current = requestAnimationFrame(() => { setTimeout(tick, 150); });
        };
        tick();
      }
    }

    start();

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [attempt]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        className={
          fault
            ? 'hidden'
            : 'w-full h-full object-cover bg-black rounded-xl'
        }
        playsInline
        muted
      />
      {/* Hidden canvas used only by the ZXing fallback path */}
      <canvas ref={canvasRef} className="hidden" />

      {fault && <CameraFallback fault={fault} onRetry={() => setAttempt((n) => n + 1)} />}
    </div>
  );
}

/**
 * What to show when there is no picture.
 *
 * The previous behaviour was to log to the console and render a black rectangle, which
 * is indistinguishable from a camera pointed at something dark — so "the camera is not
 * working" was the only report anyone could make. Each fault below states the cause and
 * the one action that resolves it.
 */
function CameraFallback({ fault, onRetry }: { fault: CameraFault; onRetry: () => void }) {
  const { title, body, retryable } = EXPLANATIONS[fault];

  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-surface px-6 text-center"
    >
      <svg viewBox="0 0 24 24" className="h-9 w-9 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 3l18 18" />
        <path d="M9.5 5h5l1.5 2.5H20a1.5 1.5 0 011.5 1.5v8.2M6.2 6.2A1.5 1.5 0 004 7.5v10A1.5 1.5 0 005.5 19h12" />
        <path d="M9.9 9.9a3.5 3.5 0 004.7 4.7" />
      </svg>

      <p className="text-sm font-extrabold text-ink">{title}</p>
      <p className="max-w-xs text-[13px] leading-relaxed text-muted">{body}</p>

      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-xl bg-primary px-4 py-2 text-xs font-extrabold text-onPrimary"
        >
          Try again
        </button>
      )}
    </div>
  );
}

const EXPLANATIONS: Record<CameraFault, { title: string; body: string; retryable: boolean }> = {
  insecure_context: {
    title: 'Camera needs a secure connection',
    body:
      'Browsers only allow camera access over HTTPS. This page was opened over plain ' +
      'HTTP, so no camera can start. Open the site over HTTPS — or on the machine ' +
      'running it, via localhost.',
    // Reloading changes nothing while the URL is the same.
    retryable: false,
  },
  unsupported: {
    title: 'This browser has no camera access',
    body:
      'Scanning needs a browser that supports camera capture. Chrome, Safari, Edge and ' +
      'Firefox all do — an in-app browser inside another application often does not.',
    retryable: false,
  },
  permission_denied: {
    title: 'Camera permission was refused',
    body:
      'Allow camera access for this site, then try again. If no prompt appeared, the ' +
      'site was blocked earlier: reach it through the padlock or camera icon in the ' +
      'address bar.',
    retryable: true,
  },
  no_camera: {
    title: 'No camera found',
    body:
      'This device has no camera available to the browser. Use a phone or tablet to ' +
      'scan, or enter the barcode by hand.',
    retryable: true,
  },
  camera_busy: {
    title: 'The camera is in use',
    body:
      'Another application or tab is holding the camera. Close it — video calls are the ' +
      'usual culprit — and try again.',
    retryable: true,
  },
  unknown: {
    title: 'The camera could not start',
    body:
      'Something stopped the camera from opening. Try again, and if it keeps failing ' +
      'enter the barcode by hand so you are not held up.',
    retryable: true,
  },
};
