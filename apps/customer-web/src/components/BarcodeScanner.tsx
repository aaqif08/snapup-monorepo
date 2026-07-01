'use client';

import { useEffect, useRef } from 'react';

interface BarcodeScannerProps {
  isActive: boolean;
  onScan: (barcode: string) => void;
}

// Suppress the zxing "already playing" noise if it ever gets imported elsewhere
if (typeof window !== 'undefined') {
  const _warn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('already playing')) return;
    _warn(...args);
  };
}

export default function BarcodeScanner({ isActive, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScanRef = useRef(onScan);
  const isActiveRef = useRef(isActive);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep refs in sync without restarting the scanner
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  useEffect(() => {
    let stopped = false;

    async function start() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

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
        console.error('[Scanner] Camera error:', err);
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
          console.error('[Scanner] ZXing load error:', err);
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
  }, []);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        className="w-full h-full object-cover bg-black rounded-xl"
        playsInline
        muted
      />
      {/* Hidden canvas used only by the ZXing fallback path */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
