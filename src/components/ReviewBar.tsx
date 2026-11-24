import { useEffect, useMemo, useRef, useState } from 'react';
import { isStale, useStore } from '../store';
import { needsReview, type Box, type Mark, type Page } from '../types';
import { applyTextEdit } from '../lib/textedit';
import { usePageImage } from './usePageImage';
import { IconCheck, IconChevronLeft, IconChevronRight, IconReplace } from './Icons';

export interface ReviewItem {
  pageId: string;
  pageIndex: number;
  blockId: string;
  blockIndex: number;
  mark: Mark;
}

/** Alle zu prüfenden Stellen in Dokumentreihenfolge (unsicher oder automatisch korrigiert). */
export function reviewItems(pages: Page[], threshold: number): ReviewItem[] {
  const out: ReviewItem[] = [];
  pages.forEach((p, pageIndex) =>
    p.doc?.blocks.forEach((b, blockIndex) => {
      if (b.type === 'hidden') return;
      for (const m of [...b.marks].sort((x, y) => x.start - y.start))
        if (m.end <= b.text.length && needsReview(m, threshold)) out.push({ pageId: p.id, pageIndex, blockId: b.id, blockIndex, mark: m });
    }),
  );
  return out;
}

const keyOf = (i: { pageIndex: number; blockIndex: number; mark: Mark }) => [i.pageIndex, i.blockIndex, i.mark.start] as const;
const cmp = (a: readonly number[], b: readonly number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Schwebende Prüfleiste: zeigt die aktuelle unsichere Stelle mit Bildausschnitt,
 * Korrekturvorschlägen und eigener Eingabe – ohne dass man im Text scrollen muss.
 */
export function ReviewBar() {
  const pages = useStore((s) => s.pages);
  const threshold = useStore((s) => s.settings.uncertainThreshold);
  const review = useStore((s) => s.review);
  const setReview = useStore((s) => s.setReview);
  const setActive = useStore((s) => s.setActive);
  const setBlocks = useStore((s) => s.setBlocks);
  const activeId = useStore((s) => s.activePageId);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => reviewItems(pages, threshold), [pages, threshold]);
  const idx = review
    ? items.findIndex((i) => i.pageId === review.pageId && i.blockId === review.blockId && i.mark.start === review.start)
    : -1;
  const cur = idx >= 0 ? items[idx] : null;
  const page = cur ? pages[cur.pageIndex] : null;
  const block = cur && page?.doc ? page.doc.blocks[cur.blockIndex] : null;
  const word = cur && block ? block.text.slice(cur.mark.start, cur.mark.end) : '';

  // Seite wird nur gewechselt, wenn in der Leiste aktiv geblättert/korrigiert wurde
  const userNav = useRef(false);

  // Ohne gültige Auswahl – oder wenn selbst auf eine andere Seite geblättert wurde:
  // erste Stelle ab der aktuellen Seite wählen (ohne die Seite zu wechseln)
  useEffect(() => {
    if (!items.length) return;
    if (cur && (cur.pageId === activeId || userNav.current)) return;
    const ai = Math.max(0, pages.findIndex((p) => p.id === activeId));
    const first = items.find((i) => i.pageIndex >= ai) ?? items[0];
    if (cur && first.pageId === cur.pageId && first.blockId === cur.blockId && first.mark.start === cur.mark.start) return;
    setReview({ pageId: first.pageId, blockId: first.blockId, start: first.mark.start });
  }, [cur, items, pages, activeId, setReview]);

  useEffect(() => setDraft(word), [word, cur?.blockId, cur?.mark.start]);

  // Zur Stelle im Text scrollen – nur nach Aktionen in der Leiste
  useEffect(() => {
    if (!cur || !userNav.current) return;
    if (cur.pageId !== activeId) setActive(cur.pageId);
    const t = window.setTimeout(() => {
      document.querySelector(`[data-block-id="${cur.blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      userNav.current = false;
    }, 60);
    return () => window.clearTimeout(t);
  }, [cur?.pageId, cur?.blockId, cur?.mark.start]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length || ocrRunning) return null;

  const go = (target: ReviewItem | undefined) => {
    if (!target) return;
    userNav.current = true;
    setReview({ pageId: target.pageId, blockId: target.blockId, start: target.mark.start });
  };
  /** Nach einer Änderung: nächste Stelle ab der bisherigen Position (die aktuelle ist dann erledigt). */
  const advanceFrom = (k: readonly number[], nextItems: ReviewItem[]) => {
    const n = nextItems.find((i) => cmp(keyOf(i), k) > 0) ?? nextItems[0];
    userNav.current = true;
    if (n) setReview({ pageId: n.pageId, blockId: n.blockId, start: n.mark.start });
    else setReview(null);
  };

  const replace = (text: string) => {
    if (!cur || !page?.doc || !block) return;
    const k = keyOf(cur);
    const nextText = block.text.slice(0, cur.mark.start) + text + block.text.slice(cur.mark.end);
    const nb = applyTextEdit(block, nextText);
    // Die bearbeitete Markierung entfällt automatisch (gilt als geprüft)
    const blocks = page.doc.blocks.map((b) => (b.id === block.id ? { ...nb, marks: nb.marks.filter((m) => m.start !== cur.mark.start) } : b));
    setBlocks(page.id, blocks);
    const after = reviewItems(useStore.getState().pages, threshold);
    advanceFrom([k[0], k[1], k[2] + text.length - 1], after);
  };
  const accept = () => {
    if (!cur || !page?.doc || !block) return;
    const k = keyOf(cur);
    setBlocks(
      page.id,
      page.doc.blocks.map((b) => (b.id === block.id ? { ...b, marks: b.marks.filter((m) => m.start !== cur.mark.start) } : b)),
    );
    advanceFrom(k, reviewItems(useStore.getState().pages, threshold));
  };

  const sugg = (cur?.mark.sugg ?? []).filter((s) => s !== word);
  const fixed = cur?.mark.orig !== undefined;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))]" data-testid="review-bar">
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-black/[0.08] bg-white/90 shadow-[0_8px_40px_rgba(0,0,0,0.14),0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3 pt-2.5 sm:px-4">
          <span className="text-[13px] font-semibold">Prüfen</span>
          <span className="text-[13px] tabular-nums text-muted" data-testid="review-count">
            {idx >= 0 ? idx + 1 : '–'} / {items.length}
          </span>
          {cur && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${fixed ? 'bg-blue-50 text-blue-800' : cur.mark.conf < 50 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              {fixed ? `Autokorrektur – erkannt war „${cur.mark.orig}“` : `Sicherheit ${cur.mark.conf} %`}
              {cur.pageId !== activeId ? '' : ''}
            </span>
          )}
          <span className="ml-auto text-[12px] text-muted">Seite {cur ? cur.pageIndex + 1 : '–'}</span>
          <button className="btn-ghost px-1.5" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Ausklappen' : 'Einklappen'}>
            {collapsed ? '▴' : '▾'}
          </button>
        </div>

        {!collapsed && cur && page && (
          <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2 sm:px-4">
            <Snippet page={page} mark={cur.mark} lineBox={lineBoxFor(block!, cur.mark)} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={input}
                className="field min-w-[9rem] flex-1 text-[15px]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (draft !== word) replace(draft);
                    else accept();
                  }
                }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label="Korrektur eingeben"
                data-testid="review-input"
              />
              {sugg.map((s) => (
                <button key={s} className="btn border-blue/30 text-blue" onClick={() => replace(s)} data-testid="review-sugg">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn px-2.5" onClick={() => go(items[idx - 1] ?? items[items.length - 1])} aria-label="Vorherige Stelle">
                <IconChevronLeft />
              </button>
              <button className="btn px-2.5" onClick={() => go(items[idx + 1] ?? items[0])} aria-label="Nächste Stelle" data-testid="review-next">
                <IconChevronRight />
              </button>
              <div className="ml-auto flex items-center gap-2">
                {fixed && (
                  <button className="btn" onClick={() => replace(cur.mark.orig!)} data-testid="review-undo">
                    <IconReplace /> Rückgängig
                  </button>
                )}
                {draft !== word ? (
                  <button className="btn-primary" onClick={() => replace(draft)} data-testid="review-apply">
                    <IconCheck /> Übernehmen
                  </button>
                ) : (
                  <button className="btn-primary" onClick={accept} data-testid="review-ok">
                    <IconCheck /> {fixed ? 'Korrektur ok' : 'Richtig'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function lineBoxFor(block: { text: string; lineBoxes: Box[] }, mark: Mark): Box | null {
  let line = 0;
  for (let i = 0; i < mark.start; i++) if (block.text.charCodeAt(i) === 10) line++;
  return block.lineBoxes[line] ?? null;
}

/** Ausschnitt aus dem Originalbild rund um das Wort. */
function Snippet({ page, mark, lineBox }: { page: Page; mark: Mark; lineBox: Box | null }) {
  const url = usePageImage(page);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const word = mark.box ?? null;
  if (!url || isStale(page) || (!word && !lineBox)) return null;
  const base = lineBox ?? word!;
  const w = word ?? base;
  // horizontal um das Wort herum zuschneiden, vertikal die ganze Zeile
  const cx = (w.x0 + w.x1) / 2;
  const half = Math.max((w.x1 - w.x0) * 2.5, 0.18);
  const x0 = Math.max(0, Math.min(cx - half, base.x0 - 0.01));
  const x1 = Math.min(1, Math.max(cx + half, x0 + 0.1));
  const pad = (base.y1 - base.y0) * 0.35;
  const y0 = Math.max(0, Math.min(base.y0, w.y0) - pad);
  const y1 = Math.min(1, Math.max(base.y1, w.y1) + pad);
  let rx0 = x0;
  let rx1 = x1;
  let ry0 = y0;
  let ry1 = y1;
  // Seitenverhältnis begrenzen, ohne das Bild zu verzerren: Ausschnitt erweitern
  const target = (a: number) => Math.max(3, Math.min(12, a));
  if (dims) {
    const a = ((rx1 - rx0) * dims.w) / ((ry1 - ry0) * dims.h);
    const t = target(a);
    if (a > t) {
      const need = ((rx1 - rx0) * dims.w) / (t * dims.h);
      const grow = (need - (ry1 - ry0)) / 2;
      ry0 = Math.max(0, ry0 - grow);
      ry1 = Math.min(1, ry1 + grow);
    } else if (a < t) {
      const need = (t * (ry1 - ry0) * dims.h) / dims.w;
      const grow = (need - (rx1 - rx0)) / 2;
      rx0 = Math.max(0, rx0 - grow);
      rx1 = Math.min(1, rx1 + grow);
    }
  }
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const aspect = dims ? (rw * dims.w) / (rh * dims.h) : 8;
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-black/5" style={{ aspectRatio: `${aspect}`, maxHeight: 96 }} data-testid="review-snippet">
      <img
        src={url}
        alt=""
        onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="absolute max-w-none"
        style={{ width: `${100 / rw}%`, height: `${100 / rh}%`, left: `${(-rx0 / rw) * 100}%`, top: `${(-ry0 / rh) * 100}%` }}
        draggable={false}
      />
      {word && (
        <div
          className="absolute rounded-sm ring-2 ring-blue/80"
          style={{ left: `${((word.x0 - rx0) / rw) * 100}%`, top: `${((word.y0 - ry0) / rh) * 100}%`, width: `${((word.x1 - word.x0) / rw) * 100}%`, height: `${((word.y1 - word.y0) / rh) * 100}%` }}
        />
      )}
    </div>
  );
}
