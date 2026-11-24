import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useStore } from '../store';
import type { Settings } from '../types';
import { createPdf, downloadBytes, safeFileName } from '../lib/exporter';
import { IconDownload, IconSpinner, IconWarn } from './Icons';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfView() {
  const pages = useStore((s) => s.pages);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setStep = useStore((s) => s.setStep);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nur Einstellungen, die das PDF verändern (nicht der Dateiname/Schwelle)
  const layoutKey = useMemo(() => {
    const { fileName: _f, uncertainThreshold: _u, preprocess: _p, psm: _s, ...rest } = settings;
    void _f; void _u; void _p; void _s;
    return JSON.stringify(rest);
  }, [settings]);

  useEffect(() => {
    if (ocrRunning) return;
    let cancelled = false;
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const st = useStore.getState();
        const out = await createPdf(st.pages, st.settings);
        if (cancelled) return;
        setBytes(out);
        const loaded = await pdfjs.getDocument({ data: out.slice() }).promise;
        if (cancelled) return;
        setDoc((old) => {
          void old?.loadingTask.destroy();
          return loaded;
        });
        setError(null);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pages, layoutKey, ocrRunning]);

  useEffect(() => () => void doc?.loadingTask.destroy(), [doc]);

  const withoutText = pages.filter((p) => !p.doc).length;
  const uncertain = pages.reduce(
    (n, p) => n + (p.doc?.blocks.reduce((m, b) => m + (b.type === 'hidden' ? 0 : b.marks.filter((x) => x.conf < settings.uncertainThreshold).length), 0) ?? 0),
    0,
  );
  const hasOrigLineNos = pages.some((p) => p.doc?.blocks.some((b) => b.lineNos.some(Boolean)));
  const hasOrigPageNos = pages.some((p) => p.doc?.origPageNo);
  const fileName = safeFileName(settings.fileName);

  const download = () => {
    if (bytes) downloadBytes(bytes, fileName);
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>);
  const textMode = settings.pdfMode === 'text';

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[340px_1fr]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[72px] lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto">
        <div className="card flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="label">Dateiname</span>
            <div className="flex items-center gap-1">
              <input
                className="field min-w-0 flex-1"
                value={settings.fileName}
                onChange={(e) => set('fileName', e.target.value)}
                placeholder="Dokument"
                data-testid="file-name"
              />
              <span className="text-sm text-muted">.pdf</span>
            </div>
          </label>
          <button className="btn-primary py-2" onClick={download} disabled={!bytes || busy} data-testid="download">
            {busy ? <IconSpinner /> : <IconDownload />} PDF herunterladen
          </button>
          {withoutText > 0 && textMode && (
            <p className="flex gap-1.5 text-xs text-amber-800">
              <IconWarn className="mt-0.5 shrink-0" width={13} height={13} />
              {withoutText} {withoutText === 1 ? 'Seite hat' : 'Seiten haben'} noch keinen erkannten Text und {withoutText === 1 ? 'fehlt' : 'fehlen'} im PDF.
            </p>
          )}
          {uncertain > 0 && (
            <p className="flex gap-1.5 text-xs text-muted">
              <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm bg-warn" />
              <span>
                {uncertain} unsichere Stellen sind noch nicht geprüft.{' '}
                <button className="underline hover:text-ink" onClick={() => setStep('editor')}>Zum Editor</button>
              </span>
            </p>
          )}
        </div>

        <div className="card flex flex-col gap-4 p-4 text-sm">
          <Group label="Ausgabe">
            <Seg
              value={settings.pdfMode}
              onChange={(v) => set('pdfMode', v)}
              options={[
                ['text', 'Neu gesetzt'],
                ['image', 'Originalbilder'],
              ]}
            />
            <p className="text-xs text-muted">
              {textMode
                ? 'Sauber gesetzter Text auf DIN A4, durchsuchbar und markierbar.'
                : 'Originalfotos mit unsichtbarer Textebene – durchsuchbar und markierbar.'}
            </p>
          </Group>

          {textMode && (
            <>
              <Group label="Schriftgröße">
                <Seg
                  value={String(settings.fontSize)}
                  onChange={(v) => set('fontSize', Number(v))}
                  options={[
                    ['10.5', '10,5 pt'],
                    ['11', '11 pt'],
                    ['11.5', '11,5 pt'],
                  ]}
                />
              </Group>

              <Group label="Zeilenumbrüche">
                <Seg
                  value={settings.lineBreaks}
                  onChange={(v) => set('lineBreaks', v)}
                  options={[
                    ['original', 'Wie Vorlage'],
                    ['flow', 'Fließtext', settings.lineNumbers === 'original'],
                  ]}
                />
                <p className="text-xs text-muted">
                  {settings.lineBreaks === 'original'
                    ? 'Jede Zeile der Vorlage beginnt eine neue Zeile – nötig für originale Zeilennummern.'
                    : 'Absätze laufen über die volle Breite; Trennstriche am Zeilenende werden zusammengeführt.'}
                </p>
              </Group>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.pageBreakPerSource} onChange={(e) => set('pageBreakPerSource', e.target.checked)} />
                Jede Vorlagenseite auf neuer PDF-Seite
              </label>

              <Group label="Seitenzahlen">
                <Seg
                  value={settings.pageNumbers}
                  onChange={(v) => set('pageNumbers', v)}
                  options={[
                    ['none', 'Keine'],
                    ['center', 'Mittig'],
                    ['right', 'Rechts'],
                  ]}
                />
                {settings.pageNumbers !== 'none' && (
                  <Seg
                    value={settings.pageNumberSource}
                    onChange={(v) => set('pageNumberSource', v)}
                    options={[
                      ['auto', '1, 2, 3 …'],
                      ['original', 'Buchseiten', !hasOrigPageNos],
                    ]}
                  />
                )}
                {settings.pageNumberSource === 'original' && settings.pageNumbers !== 'none' && (
                  <p className="text-xs text-muted">Übernimmt die erkannten Seitenzahlen der Vorlage (im Editor prüfbar).</p>
                )}
              </Group>

              <Group label="Zeilennummern">
                <select
                  className="field"
                  value={settings.lineNumbers}
                  onChange={(e) => {
                    const v = e.target.value as Settings['lineNumbers'];
                    updateSettings(v === 'original' ? { lineNumbers: v, lineBreaks: 'original' } : { lineNumbers: v });
                  }}
                  data-testid="line-numbers"
                >
                  <option value="none">Keine</option>
                  <option value="page">Neu – pro Seite</option>
                  <option value="document">Neu – fortlaufend</option>
                  <option value="original" disabled={!hasOrigLineNos}>
                    Original aus der Vorlage{hasOrigLineNos ? '' : ' (keine erkannt)'}
                  </option>
                </select>
                {(settings.lineNumbers === 'page' || settings.lineNumbers === 'document') && (
                  <Seg
                    value={String(settings.lineNumberInterval)}
                    onChange={(v) => set('lineNumberInterval', Number(v) as 1 | 5)}
                    options={[
                      ['5', 'Alle 5 Zeilen'],
                      ['1', 'Jede Zeile'],
                    ]}
                  />
                )}
                {settings.lineNumbers === 'original' && (
                  <p className="text-xs text-muted">Originale Zeilennummern erscheinen kursiv am linken Rand – so sind sie von neu gezählten nicht zu verwechseln.</p>
                )}
                {(settings.lineNumbers === 'page' || settings.lineNumbers === 'document') && (
                  <p className="text-xs text-muted">Neu gezählte Nummern stehen aufrecht am linken Rand und zählen nur Textzeilen.</p>
                )}
              </Group>
            </>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Vorschau</span>
          <span className="flex items-center gap-2 text-muted">
            {busy && <IconSpinner />}
            {doc ? `${doc.numPages} ${doc.numPages === 1 ? 'Seite' : 'Seiten'} · DIN A4` : ''}
          </span>
        </div>
        {ocrRunning && <div className="card p-4 text-sm text-muted">Die Texterkennung läuft noch. Die Vorschau wird danach erstellt.</div>}
        {error && <div className="card border-red-200 p-4 text-sm text-red-700">PDF konnte nicht erstellt werden: {error}</div>}
        <div className="flex flex-col items-center gap-5 rounded-xl bg-neutral-200/60 p-4 sm:p-6" data-testid="preview">
          {doc ? (
            Array.from({ length: doc.numPages }, (_, i) => <PreviewPage key={`${i}`} doc={doc} num={i + 1} />)
          ) : (
            <div className="flex h-96 items-center justify-center text-muted"><IconSpinner /></div>
          )}
        </div>
      </section>
    </div>
  );
}

function PreviewPage({ doc, num }: { doc: PDFDocumentProxy; num: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(num <= 2);
  const [ratio, setRatio] = useState(Math.SQRT2);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(num);
      if (cancelled || !canvas.current || !box.current) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const cssW = box.current.clientWidth || 800;
      const scale = (cssW / base.width) * Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, num, visible]);

  return (
    <div ref={box} className="w-full max-w-[820px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.06)]" style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={canvas} className="block h-full w-full" aria-label={`PDF-Seite ${num}`} />
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string, boolean?][];
}) {
  return (
    <div className="flex rounded-md bg-neutral-100 p-0.5">
      {options.map(([v, l, disabled]) => (
        <button
          key={v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`flex-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-35 ${
            value === v ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
