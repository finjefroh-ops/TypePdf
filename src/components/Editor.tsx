import { useEffect, useMemo, useRef, useState } from 'react';
import { isStale, useStore } from '../store';
import type { Block, BlockType, Page, PageDoc } from '../types';
import { renderTransformed, canvasToBlob } from '../lib/image';
import { applyTextEdit, mergeBlocks, splitBlock } from '../lib/textedit';
import { newId } from '../lib/analyze';
import { HighlightTextarea, type HighlightHandle } from './HighlightTextarea';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconMerge,
  IconPageBreak,
  IconReplace,
  IconSpinner,
  IconSplit,
  IconTrash,
  IconWarn,
} from './Icons';

const TYPE_LABEL: Record<BlockType, string> = {
  h1: 'Überschrift 1',
  h2: 'Überschrift 2',
  p: 'Absatz',
  footnote: 'Fußnote',
  hidden: 'Ausgeblendet',
};

/** Vorherige OCR-Ergebnisse zum Wiederherstellen (nur in dieser Sitzung). */
const undoDocs = new Map<string, PageDoc>();

export function Editor() {
  const pages = useStore((s) => s.pages);
  const activeId = useStore((s) => s.activePageId);
  const setActive = useStore((s) => s.setActive);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const threshold = useStore((s) => s.settings.uncertainThreshold);
  const updateSettings = useStore((s) => s.updateSettings);

  const page = pages.find((p) => p.id === activeId) ?? pages[0];
  const index = page ? pages.indexOf(page) : -1;

  useEffect(() => {
    if (page && page.id !== activeId) setActive(page.id);
  }, [page, activeId, setActive]);

  const totalUncertain = useMemo(
    () => pages.reduce((n, p) => n + (p.doc ? countUncertain(p.doc, threshold) : 0), 0),
    [pages, threshold],
  );

  if (!page) {
    return <div className="p-10 text-center text-muted">Noch keine Seiten. Lade zuerst Bilder hoch.</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <OcrProgress />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn px-2" onClick={() => setActive(pages[index - 1]?.id ?? page.id)} disabled={index <= 0} aria-label="Vorherige Seite">
            <IconChevronLeft />
          </button>
          <select className="field" value={page.id} onChange={(e) => setActive(e.target.value)} aria-label="Seite wählen">
            {pages.map((p, i) => (
              <option key={p.id} value={p.id}>
                Seite {i + 1} von {pages.length}
                {p.doc?.origPageNo ? ` · S. ${p.doc.origPageNo}` : ''}
                {p.status === 'running' ? ' · wird erkannt' : p.status === 'queued' ? ' · wartet' : !p.doc ? ' · ohne Text' : ''}
              </option>
            ))}
          </select>
          <button
            className="btn px-2"
            onClick={() => setActive(pages[index + 1]?.id ?? page.id)}
            disabled={index >= pages.length - 1}
            aria-label="Nächste Seite"
          >
            <IconChevronRight />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted" title="Wörter unter dieser Erkennungssicherheit werden markiert">
            Markieren unter
            <select
              className="field py-1"
              value={threshold}
              onChange={(e) => updateSettings({ uncertainThreshold: Number(e.target.value) })}
            >
              {[60, 70, 80, 85, 90].map((v) => (
                <option key={v} value={v}>
                  {v} % Sicherheit
                </option>
              ))}
            </select>
          </label>
          <span className="inline-flex items-center gap-1.5 text-muted" data-testid="uncertain-total">
            <span className="inline-block h-3 w-3 rounded-sm bg-warn" /> {totalUncertain} unsichere Stellen gesamt
          </span>
          {ocrRunning ? null : <NextUncertainButton />}
        </div>
      </div>

      <PageEditor key={page.id} page={page} index={index} />
    </div>
  );
}

function countUncertain(doc: PageDoc, threshold: number) {
  return doc.blocks.reduce((n, b) => n + (b.type === 'hidden' ? 0 : b.marks.filter((m) => m.conf < threshold).length), 0);
}

function OcrProgress() {
  const pages = useStore((s) => s.pages);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const status = useStore((s) => s.ocrStatus);
  const cancel = useStore((s) => s.cancelOcr);
  if (!ocrRunning) return null;
  const targets = pages.filter((p) => p.status === 'queued' || p.status === 'running' || (p.status === 'done' && p.progress === 1));
  const running = pages.find((p) => p.status === 'running');
  const queued = pages.filter((p) => p.status === 'queued').length;
  const runningIdx = running ? pages.indexOf(running) + 1 : 0;
  const overall = pages.length ? (pages.filter((p) => p.status === 'done').length + (running?.progress ?? 0)) / Math.max(1, targets.length) : 0;
  return (
    <div className="card flex flex-col gap-2 p-4" data-testid="ocr-progress">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <IconSpinner />
          {running ? `Seite ${runningIdx}: ${status || 'Texterkennung'} … ${Math.round(running.progress * 100)} %` : 'Texterkennung wird vorbereitet …'}
          {queued > 0 && <span className="text-muted">· {queued} weitere in der Warteschlange</span>}
        </span>
        <button className="btn-ghost" onClick={cancel}>Nach dieser Seite anhalten</button>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-neutral-200">
        <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, overall * 100)}%` }} />
      </div>
    </div>
  );
}

/* ---------- Navigation zu unsicheren Stellen ---------- */

const textareaRefs = new Map<string, HighlightHandle>();
let pendingSelect: { blockId: string; start: number; end: number } | null = null;
let lastJump: { pageId: string; blockId: string; start: number } | null = null;

function NextUncertainButton() {
  const pages = useStore((s) => s.pages);
  const activeId = useStore((s) => s.activePageId);
  const setActive = useStore((s) => s.setActive);
  const threshold = useStore((s) => s.settings.uncertainThreshold);

  const jump = () => {
    // Alle Stellen in Dokumentreihenfolge: [Seite, Abschnitt, Position]
    const all: { pageId: string; blockId: string; start: number; end: number; key: [number, number, number] }[] = [];
    pages.forEach((p, pi) =>
      (p.doc?.blocks ?? []).forEach((b, bi) => {
        if (b.type === 'hidden') return;
        for (const m of b.marks)
          if (m.conf < threshold) all.push({ pageId: p.id, blockId: b.id, start: m.start, end: m.end, key: [pi, bi, m.start] });
      }),
    );
    if (!all.length) return;
    all.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1] || x.key[2] - y.key[2]);
    const after = (k: [number, number, number], l: [number, number, number]) =>
      k[0] !== l[0] ? k[0] > l[0] : k[1] !== l[1] ? k[1] > l[1] : k[2] > l[2];
    let from: [number, number, number];
    const lj = lastJump;
    const lastPi = lj ? pages.findIndex((p) => p.id === lj.pageId) : -1;
    if (lj && lastPi >= 0 && pages[lastPi].id === activeId) {
      const bi = pages[lastPi].doc?.blocks.findIndex((b) => b.id === lj.blockId) ?? -1;
      from = [lastPi, bi, lj.start];
    } else {
      from = [Math.max(0, pages.findIndex((p) => p.id === activeId)), -1, -1];
    }
    const target = all.find((a) => after(a.key, from)) ?? all[0];
    lastJump = { pageId: target.pageId, blockId: target.blockId, start: target.start };
    if (target.pageId !== activeId) {
      pendingSelect = target;
      setActive(target.pageId);
    } else {
      textareaRefs.get(target.blockId)?.select(target.start, target.end);
    }
  };

  return (
    <button className="btn" onClick={jump} data-testid="next-uncertain">
      <IconWarn /> Nächste unsichere Stelle
    </button>
  );
}

/* ---------- Seite ---------- */

function PageEditor({ page, index }: { page: Page; index: number }) {
  const setBlocks = useStore((s) => s.setBlocks);
  const updatePage = useStore((s) => s.updatePage);
  const runOcr = useStore((s) => s.runOcr);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const threshold = useStore((s) => s.settings.uncertainThreshold);
  const [focused, setFocused] = useState<string | null>(null);
  const carets = useRef(new Map<string, number>());
  const doc = page.doc;
  const stale = isStale(page);

  useEffect(() => {
    if (pendingSelect && doc?.blocks.some((b) => b.id === pendingSelect!.blockId)) {
      const t = pendingSelect;
      pendingSelect = null;
      window.setTimeout(() => textareaRefs.get(t.blockId)?.select(t.start, t.end), 50);
    }
  }, [doc]);

  const blocks = doc?.blocks ?? [];
  const setB = (next: Block[]) => setBlocks(page.id, next);
  const updateBlock = (id: string, fn: (b: Block) => Block) => setB(blocks.map((b) => (b.id === id ? fn(b) : b)));

  const rerun = async () => {
    if (doc?.edited && !confirm('Der Text dieser Seite wurde bearbeitet. Bei erneuter Erkennung wird er ersetzt (Wiederherstellen danach möglich). Fortfahren?')) return;
    if (doc) undoDocs.set(page.id, doc);
    await runOcr([page.id], true);
  };
  const restore = () => {
    const prev = undoDocs.get(page.id);
    if (!prev) return;
    undoDocs.delete(page.id);
    updatePage(page.id, { doc: prev, status: 'done' });
  };

  const uncertain = doc ? countUncertain(doc, threshold) : 0;
  const focusedBlock = blocks.find((b) => b.id === focused) ?? null;

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Links: Originalbild */}
      <ImagePane page={page} highlight={focusedBlock} />

      {/* Rechts: Text */}
      <div className="card flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">Erkannter Text</span>
            {doc && (
              <span className="text-muted">
                {' '}
                · Sicherheit {Math.round(doc.meanConf)} % · {uncertain} unsicher
                {doc.origPageNo ? ` · Buchseite ${doc.origPageNo}` : ''}
                {doc.edited ? ' · bearbeitet' : ''}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {doc && uncertain > 0 && (
              <button
                className="btn-ghost"
                title="Alle Markierungen dieser Seite als geprüft entfernen"
                onClick={() => setB(blocks.map((b) => ({ ...b, marks: b.marks.filter((m) => m.conf >= threshold) })))}
              >
                <IconCheck /> Seite geprüft
              </button>
            )}
            {undoDocs.has(page.id) && !ocrRunning && (
              <button className="btn-ghost" onClick={restore}>Vorherigen Text wiederherstellen</button>
            )}
            <button className="btn-ghost" onClick={rerun} disabled={ocrRunning} title="Texterkennung für diese Seite erneut ausführen">
              <IconReplace /> {doc ? 'Neu erkennen' : 'Erkennen'}
            </button>
          </div>
        </div>

        {doc && doc.meanConf < 65 && doc.blocks.length > 0 && (
          <div className="flex items-start gap-2 border-b border-line bg-red-50 px-4 py-2 text-xs text-red-900" data-testid="low-quality">
            <IconWarn className="mt-0.5 shrink-0" />
            Diese Seite ist schwer lesbar (Sicherheit {Math.round(doc.meanConf)} %). Viele Stellen sind vermutlich falsch erkannt. Empfehlung: neu fotografieren – näher, scharf, gleichmäßig beleuchtet – und das Bild über „Seiten“ ersetzen.
          </div>
        )}
        {stale && (
          <div className="flex items-start gap-2 border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <IconWarn className="mt-0.5 shrink-0" />
            Das Bild wurde nach der Texterkennung verändert. Der Text bleibt erhalten; bei Bedarf „Neu erkennen“.
          </div>
        )}

        {index > 0 && doc && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-2 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={page.joinWithPrevious}
                onChange={(e) => updatePage(page.id, { joinWithPrevious: e.target.checked, continueParagraph: e.target.checked && page.continueParagraph })}
              />
              Mit vorheriger Seite zusammenführen (kein Seitenumbruch)
            </label>
            <label className={`flex items-center gap-1.5 ${page.joinWithPrevious ? '' : 'opacity-40'}`}>
              <input
                type="checkbox"
                disabled={!page.joinWithPrevious}
                checked={page.continueParagraph}
                onChange={(e) => updatePage(page.id, { continueParagraph: e.target.checked })}
              />
              Ersten Absatz fortsetzen
            </label>
          </div>
        )}

        <div className="flex flex-col gap-1 p-2 sm:p-3" data-testid="block-list">
          {!doc && page.status !== 'running' && page.status !== 'queued' && (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted">
              {page.status === 'error' ? (
                <>
                  <IconWarn width={22} height={22} />
                  Die Erkennung ist fehlgeschlagen: {page.error}
                </>
              ) : (
                'Für diese Seite wurde noch kein Text erkannt.'
              )}
              <button className="btn-primary" onClick={rerun} disabled={ocrRunning}>Text erkennen</button>
            </div>
          )}
          {!doc && (page.status === 'running' || page.status === 'queued') && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <IconSpinner /> {page.status === 'running' ? `Text wird erkannt … ${Math.round(page.progress * 100)} %` : 'Wartet auf Erkennung …'}
            </div>
          )}
          {doc && blocks.length === 0 && (
            <div className="py-12 text-center text-sm text-muted">Auf dieser Seite wurde kein Text gefunden.</div>
          )}
          {blocks.map((b, bi) => (
            <BlockRow
              key={b.id}
              block={b}
              first={bi === 0}
              last={bi === blocks.length - 1}
              threshold={threshold}
              focused={focused === b.id}
              onFocus={() => setFocused(b.id)}
              onCaret={(pos) => carets.current.set(b.id, pos)}
              onText={(t) => updateBlock(b.id, (old) => applyTextEdit(old, t))}
              onType={(type) => updateBlock(b.id, (old) => ({ ...old, type, note: type === 'hidden' ? old.note : undefined }))}
              onPageBreak={() => updateBlock(b.id, (old) => ({ ...old, pageBreakBefore: !old.pageBreakBefore }))}
              onChecked={() => updateBlock(b.id, (old) => ({ ...old, marks: old.marks.filter((m) => m.conf >= threshold) }))}
              onMerge={() => {
                const next = blocks[bi + 1];
                if (!next) return;
                const merged = mergeBlocks(b, next);
                setB([...blocks.slice(0, bi), merged, ...blocks.slice(bi + 2)]);
              }}
              onSplit={() => {
                const pos = carets.current.get(b.id) ?? 0;
                const parts = splitBlock(b, pos);
                if (!parts) {
                  alert('Setze den Cursor zuerst an die Stelle im Text, an der getrennt werden soll.');
                  return;
                }
                setB([...blocks.slice(0, bi), parts[0], parts[1], ...blocks.slice(bi + 1)]);
              }}
              onDelete={() => {
                if (!confirm('Diesen Abschnitt löschen?')) return;
                setB(blocks.filter((x) => x.id !== b.id));
              }}
            />
          ))}
          {doc && (
            <button
              className="btn-ghost mt-1 self-start"
              onClick={() => setB([...blocks, { id: newId(), type: 'p', text: '', marks: [], lineNos: [null], lineBoxes: [] }])}
            >
              + Absatz hinzufügen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockRow(props: {
  block: Block;
  first: boolean;
  last: boolean;
  threshold: number;
  focused: boolean;
  onFocus: () => void;
  onCaret: (pos: number) => void;
  onText: (t: string) => void;
  onType: (t: BlockType) => void;
  onPageBreak: () => void;
  onChecked: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
}) {
  const { block: b, threshold } = props;
  const uncertain = b.marks.filter((m) => m.conf < threshold).length;
  const hidden = b.type === 'hidden';
  const textCls =
    b.type === 'h1' ? 'font-semibold [&_.hl-input]:text-[18px] [&_.hl-backdrop]:text-[18px]' : b.type === 'h2' ? 'font-semibold' : b.type === 'footnote' ? '[&_.hl-input]:text-[13px] [&_.hl-backdrop]:text-[13px]' : '';

  return (
    <div className="flex flex-col">
      {b.pageBreakBefore && (
        <div className="my-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
          <div className="h-px flex-1 border-t border-dashed border-neutral-300" /> Seitenumbruch <div className="h-px flex-1 border-t border-dashed border-neutral-300" />
        </div>
      )}
      <div
        className={`group rounded-lg border transition-colors ${props.focused ? 'border-neutral-300 bg-white' : 'border-transparent hover:border-line'} ${hidden ? 'opacity-55' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-1 px-2 pt-1.5 text-xs text-muted">
          <select
            className="rounded border-0 bg-transparent py-0.5 pr-1 text-xs text-muted hover:bg-neutral-100 focus:bg-neutral-100"
            value={b.type}
            onChange={(e) => props.onType(e.target.value as BlockType)}
            aria-label="Formatierung"
          >
            {(Object.keys(TYPE_LABEL) as BlockType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {hidden && b.note && <span className="rounded bg-neutral-100 px-1.5">{b.note} – nicht im PDF</span>}
          {uncertain > 0 && (
            <button className="rounded bg-amber-50 px-1.5 text-amber-900 hover:bg-amber-100" onClick={props.onChecked} title="Markierungen in diesem Abschnitt als geprüft entfernen">
              {uncertain} unsicher · geprüft ✓
            </button>
          )}
          <div className={`ml-auto flex items-center ${props.focused ? '' : 'opacity-60 group-hover:opacity-100'}`}>
            <button className="btn-ghost px-1.5 py-0.5" onClick={props.onSplit} title="Abschnitt am Cursor teilen"><IconSplit width={14} height={14} /></button>
            <button className="btn-ghost px-1.5 py-0.5" onClick={props.onMerge} disabled={props.last} title="Mit nächstem Abschnitt verbinden"><IconMerge width={14} height={14} /></button>
            <button
              className={`btn-ghost px-1.5 py-0.5 ${b.pageBreakBefore ? 'text-accent' : ''}`}
              onClick={props.onPageBreak}
              disabled={props.first && !b.pageBreakBefore}
              title="Seite vor diesem Abschnitt trennen (Seitenumbruch)"
            >
              <IconPageBreak width={14} height={14} />
            </button>
            <button className="btn-ghost px-1.5 py-0.5 hover:text-red-700" onClick={props.onDelete} title="Abschnitt löschen"><IconTrash width={14} height={14} /></button>
          </div>
        </div>
        <HighlightTextarea
          ref={(h) => {
            if (h) textareaRefs.set(b.id, h);
            else textareaRefs.delete(b.id);
          }}
          text={b.text}
          marks={b.marks}
          lineNos={b.lineNos}
          threshold={threshold}
          showGutter
          className={textCls}
          onChange={props.onText}
          onFocus={props.onFocus}
          onCaret={props.onCaret}
          ariaLabel={TYPE_LABEL[b.type]}
        />
      </div>
    </div>
  );
}

/* ---------- Bildansicht ---------- */

const imageCache = new Map<string, string>();

function ImagePane({ page, highlight }: { page: Page; highlight: Block | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const key = `${page.id}:${page.rotation}:${page.skew}:${JSON.stringify(page.crop)}:${page.blob.size}`;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = imageCache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    renderTransformed(page, 2000)
      .then((c) => canvasToBlob(c, 'image/jpeg', 0.88))
      .then((b) => {
        if (cancelled) return;
        const u = URL.createObjectURL(b);
        imageCache.set(key, u);
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, page]);

  const boxes = highlight?.lineBoxes ?? [];
  const showBoxes = !isStale(page);

  useEffect(() => {
    // Zur hervorgehobenen Stelle scrollen
    if (!boxes.length || !scroller.current || !showBoxes) return;
    const el = scroller.current;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const y = boxes[0].y0 * inner.offsetHeight - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }, [highlight?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card flex min-h-[40vh] flex-col overflow-hidden lg:sticky lg:top-[72px] lg:h-[calc(100dvh-96px)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
        <span className="truncate font-medium">Original</span>
        <div className="flex items-center gap-1">
          {[1, 1.5, 2.5].map((z) => (
            <button key={z} className={`btn-ghost px-2 ${zoom === z ? 'bg-neutral-100 text-ink' : ''}`} onClick={() => setZoom(z)}>
              {z === 1 ? 'Ganz' : `${z * 100} %`}
            </button>
          ))}
        </div>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-neutral-100 p-3">
        <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
          {url ? (
            <img src={url} alt={`Originalseite ${page.name}`} className="block w-full shadow-sm" draggable={false} />
          ) : (
            <div className="flex h-64 items-center justify-center text-muted"><IconSpinner /></div>
          )}
          {url && showBoxes &&
            boxes.map((bx, i) => (
              <div
                key={i}
                className="pointer-events-none absolute rounded-sm bg-accent/15 ring-1 ring-accent/50"
                style={{
                  left: `${bx.x0 * 100 - 0.4}%`,
                  top: `${bx.y0 * 100 - 0.2}%`,
                  width: `${(bx.x1 - bx.x0) * 100 + 0.8}%`,
                  height: `${(bx.y1 - bx.y0) * 100 + 0.4}%`,
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
