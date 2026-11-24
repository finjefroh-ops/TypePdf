import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { estimateSkew, renderTransformed } from '../lib/image';
import type { Crop, Rotation } from '../types';
import { IconCheck, IconCrop, IconRotateLeft, IconRotateRight, IconSpinner, IconWand, IconX } from './Icons';

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05;

export function ImageEditor({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const page = useStore((s) => s.pages.find((p) => p.id === pageId));
  const updateTransform = useStore((s) => s.updateTransform);
  const [rotation, setRotation] = useState<Rotation>(page?.rotation ?? 0);
  const [skew, setSkew] = useState(page?.skew ?? 0);
  const [crop, setCrop] = useState<Crop>(page?.crop ?? FULL);
  const [cropMode, setCropMode] = useState(!!page?.crop);
  const [preview, setPreview] = useState<string | null>(null);
  const [aspect, setAspect] = useState(0.75);
  const [auto, setAuto] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ h: Handle; x: number; y: number; c: Crop } | null>(null);

  // Vorschau ohne Zuschnitt rendern (Zuschnitt wird darüber angezeigt)
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    let url: string | null = null;
    const t = window.setTimeout(async () => {
      const c = await renderTransformed({ blob: page.blob, rotation, skew, crop: null }, 1400, { ignoreCrop: true });
      if (cancelled) return;
      setAspect(c.width / c.height);
      c.toBlob((b) => {
        if (!b || cancelled) return;
        url = URL.createObjectURL(b);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      }, 'image/jpeg', 0.85);
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [page, rotation, skew]);

  useEffect(() => () => setPreview((old) => (old && URL.revokeObjectURL(old), null)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!page) return null;

  const rotate = (d: number) => {
    setRotation((r) => ((((r + d) % 360) + 360) % 360) as Rotation);
    setCrop(FULL); // Ausschnitt bezieht sich auf die Ausrichtung
  };

  const runAuto = async () => {
    setAuto(true);
    try {
      const corr = await estimateSkew({ blob: page.blob, rotation, skew, crop: cropMode ? crop : null });
      setSkew((s) => Math.max(-15, Math.min(15, Math.round((s + corr) * 10) / 10)));
    } finally {
      setAuto(false);
    }
  };

  const onPointerDown = (h: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { h, x: e.clientX, y: e.clientY, c: crop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = frame.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.x) / r.width;
    const dy = (e.clientY - d.y) / r.height;
    let { x, y, w, h } = d.c;
    if (d.h === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      if (d.h.includes('w')) {
        const nx = Math.min(x + w - MIN, Math.max(0, x + dx));
        w = w + (x - nx);
        x = nx;
      }
      if (d.h.includes('e')) w = Math.min(1 - x, Math.max(MIN, w + dx));
      if (d.h.includes('n')) {
        const ny = Math.min(y + h - MIN, Math.max(0, y + dy));
        h = h + (y - ny);
        y = ny;
      }
      if (d.h.includes('s')) h = Math.min(1 - y, Math.max(MIN, h + dy));
    }
    setCrop({ x, y, w, h });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const apply = () => {
    const finalCrop = cropMode && (crop.w < 0.999 || crop.h < 0.999 || crop.x > 0.001 || crop.y > 0.001) ? crop : null;
    updateTransform(page.id, { rotation, skew, crop: finalCrop });
    onClose();
  };

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handlePos: Record<string, string> = {
    nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
    n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
    ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
    e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
    se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
    s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
    sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
    w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="m-auto flex h-full max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-surface sm:h-[92vh] sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="font-medium">Bild bearbeiten</div>
            <div className="truncate text-xs text-muted">{page.name}</div>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Schließen"><IconX /></button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100 p-6">
          <div
            ref={frame}
            className="relative max-h-full max-w-full select-none"
            style={{ aspectRatio: String(aspect), height: aspect < 1 ? '100%' : undefined, width: aspect >= 1 ? '100%' : undefined }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-contain shadow-sm" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted"><IconSpinner /></div>
            )}
            {showGrid && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(31,42,68,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(31,42,68,.28) 1px, transparent 1px)',
                  backgroundSize: '100% 4%, 6% 100%',
                }}
              />
            )}
            {cropMode && (
              <>
                {/* Abdunkelung außerhalb */}
                <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'none' }}>
                  <div className="absolute bg-black/45" style={{ left: 0, top: 0, right: 0, height: `${crop.y * 100}%` }} />
                  <div className="absolute bg-black/45" style={{ left: 0, bottom: 0, right: 0, height: `${(1 - crop.y - crop.h) * 100}%` }} />
                  <div className="absolute bg-black/45" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.h * 100}%` }} />
                  <div className="absolute bg-black/45" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.w) * 100}%`, height: `${crop.h * 100}%` }} />
                </div>
                <div
                  className="absolute cursor-move touch-none border border-white outline outline-1 outline-black/40"
                  style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                  onPointerDown={onPointerDown('move')}
                >
                  {handles.map((h) => (
                    <div
                      key={h}
                      onPointerDown={onPointerDown(h)}
                      className={`absolute h-5 w-5 touch-none rounded-full border-2 border-white bg-accent shadow ${handlePos[h]}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => rotate(-90)} title="90° nach links"><IconRotateLeft /> Links</button>
            <button className="btn" onClick={() => rotate(90)} title="90° nach rechts"><IconRotateRight /> Rechts</button>
            <button
              className={`btn ${cropMode ? 'border-accent text-accent' : ''}`}
              onClick={() => {
                setCropMode((m) => !m);
                if (cropMode) setCrop(FULL);
              }}
              data-testid="toggle-crop"
            >
              <IconCrop /> {cropMode ? 'Zuschnitt aufheben' : 'Zuschneiden'}
            </button>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-3 md:justify-center">
            <span className="text-sm text-muted">Begradigen</span>
            <input
              type="range"
              min={-15}
              max={15}
              step={0.1}
              value={skew}
              onChange={(e) => setSkew(parseFloat(e.target.value))}
              onPointerDown={() => setShowGrid(true)}
              onPointerUp={() => setShowGrid(false)}
              className="w-40 accent-[#1f2a44]"
              aria-label="Begradigen"
            />
            <span className="w-12 text-sm tabular-nums">{skew.toFixed(1)}°</span>
            <button className="btn" onClick={runAuto} disabled={auto} title="Schräglage automatisch erkennen">
              {auto ? <IconSpinner /> : <IconWand />} Automatisch
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost"
              onClick={() => {
                setRotation(0);
                setSkew(0);
                setCrop(FULL);
                setCropMode(false);
              }}
            >
              Zurücksetzen
            </button>
            <button className="btn-primary" onClick={apply} data-testid="apply-image"><IconCheck /> Übernehmen</button>
          </div>
        </div>
        {page.doc && (
          <div className="border-t border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">
            Für diese Seite gibt es bereits erkannten Text. Nach Änderungen am Bild kann die Erkennung im Editor erneut ausgeführt werden – dein bearbeiteter Text wird dabei nicht ohne Rückfrage überschrieben.
          </div>
        )}
      </div>
    </div>
  );
}
