'use client';

/**
 * Crop step for firm-profile headshots. The PDF frames every photo at
 * HEADSHOT_AR, so an uncropped upload gets an arbitrary centre crop that often
 * cuts the head off. Pan + zoom here and the exported frame is what was chosen.
 *
 * The confirmed crop is re-encoded as a modest JPEG: camera headshots run
 * 3–10 MB, which the platform rejects with a non-JSON 413 before the route's
 * own size check runs, and PDFKit only reads JPEG/PNG.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { HEADSHOT_AR } from '@/lib/firm-profile/photo';

const FRAME_W = 288;
const FRAME_H = Math.round(FRAME_W / HEADSHOT_AR);
const OUT_MAX_W = 720; // the 84pt-wide PDF frame is ~350px at 300 dpi
const MAX_BYTES = 1_800_000; // under the avatars bucket's 2 MiB cap
const MAX_ZOOM = 3;
// Headshots sit high in the frame, so bias the default crop above centre.
const TOP_BIAS = 0.35;

async function encodeJpeg(canvas: HTMLCanvasElement): Promise<File> {
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  }
  throw new Error('That image is too detailed to compress — try a smaller one.');
}

export default function HeadshotCropper({ file, name, onCancel, onCropped }: {
  file: File;
  name: string;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    // Revoking on cleanup makes a discarded loader (StrictMode's double mount)
    // fire onerror, so a stale attempt must not touch state.
    let alive = true;
    el.onload = () => {
      if (alive) setImg(el);
    };
    el.onerror = () => {
      if (alive) setError('Couldn’t read that image — try a PNG or JPEG.');
    };
    el.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Scale at which the image exactly covers the frame — zoom multiplies it.
  const base = img ? Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight) : 1;
  const dw = img ? img.naturalWidth * base * zoom : 0;
  const dh = img ? img.naturalHeight * base * zoom : 0;

  const clamp = useCallback((o: { x: number; y: number }, w: number, h: number) => ({
    x: Math.min(0, Math.max(FRAME_W - w, o.x)),
    y: Math.min(0, Math.max(FRAME_H - h, o.y)),
  }), []);

  useEffect(() => {
    if (!img) return;
    const b = Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight);
    setZoom(1);
    setOff({
      x: (FRAME_W - img.naturalWidth * b) / 2,
      y: (FRAME_H - img.naturalHeight * b) * TOP_BIAS,
    });
  }, [img]);

  // Zoom about the frame's centre so the subject doesn't drift off-frame.
  const applyZoom = (next: number) => {
    if (!img) return;
    const nz = Math.min(MAX_ZOOM, Math.max(1, next));
    const k = nz / zoom;
    const w = img.naturalWidth * base * nz;
    const h = img.naturalHeight * base * nz;
    setOff((o) => clamp({
      x: FRAME_W / 2 - (FRAME_W / 2 - o.x) * k,
      y: FRAME_H / 2 - (FRAME_H / 2 - o.y) * k,
    }, w, h));
    setZoom(nz);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOff(clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }, dw, dh));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const s = base * zoom;
      const sw = FRAME_W / s;
      const sh = FRAME_H / s;
      const outW = Math.max(320, Math.min(OUT_MAX_W, Math.round(sw)));
      const outH = Math.round(outW / HEADSHOT_AR);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unsupported');
      ctx.drawImage(img, -off.x / s, -off.y / s, sw, sh, 0, 0, outW, outH);
      onCropped(await encodeJpeg(canvas));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Crop headshot</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {name ? `${name} — drag` : 'Drag'} to position, zoom to fill the frame. This is exactly what the PDF shows.
          </p>
        </div>

        <div className="p-4 flex flex-col items-center gap-3">
          <div
            className="relative overflow-hidden rounded-md bg-zinc-900 touch-none select-none cursor-grab active:cursor-grabbing"
            style={{ width: FRAME_W, height: FRAME_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {img ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{ position: 'absolute', left: off.x, top: off.y, width: dw, height: dh, maxWidth: 'none' }}
                />
                <div className="pointer-events-none absolute inset-0 border border-white/40" />
                <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/20" />
                <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-white/20" />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 w-full">
            <button type="button" onClick={() => applyZoom(zoom - 0.2)} disabled={!img || zoom <= 1} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40 cursor-pointer">
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!img}
              onChange={(e) => applyZoom(Number(e.target.value))}
              className="flex-1 accent-gold-500 cursor-pointer"
              aria-label="Zoom"
            />
            <button type="button" onClick={() => applyZoom(zoom + 0.2)} disabled={!img || zoom >= MAX_ZOOM} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40 cursor-pointer">
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {error && <p className="text-xs text-red-500 self-start">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!img || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 dark:bg-gold-600 dark:hover:bg-gold-500 cursor-pointer disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Use photo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
