import { lazy, Suspense, useEffect } from 'react';
import { flushSave, useStore } from './store';
import type { Step } from './types';
import { UploadZone } from './components/UploadZone';
import { PageManager } from './components/PageManager';
import { Editor } from './components/Editor';
import { warmUpOcr } from './lib/ocr';
import { IconSpinner } from './components/Icons';

// PDF-Bibliotheken erst laden, wenn die Vorschau gebraucht wird
const PdfView = lazy(() => import('./components/PdfView').then((m) => ({ default: m.PdfView })));

const STEPS: { id: Step; label: string }[] = [
  { id: 'pages', label: 'Seiten' },
  { id: 'editor', label: 'Text' },
  { id: 'pdf', label: 'PDF' },
];

export default function App() {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const pages = useStore((s) => s.pages);
  const reset = useStore((s) => s.reset);
  const savedAt = useStore((s) => s.savedAt);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const hasText = pages.some((p) => p.doc);

  // OCR-Modell im Hintergrund vorladen, sobald Seiten vorhanden sind
  useEffect(() => {
    if (pages.length) warmUpOcr();
  }, [pages.length]);

  // Vor dem Schließen sichern bzw. warnen, solange die Erkennung läuft
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      flushSave();
      if (ocrRunning) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [ocrRunning]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const enabled = (s: Step) => s === 'pages' || (s === 'editor' ? pages.length > 0 : hasText);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6">
          <button className="text-[15px] font-bold tracking-[0.18em]" onClick={() => setStep('pages')}>
            TYPEPDF
          </button>
          {pages.length > 0 && (
            <nav className="flex rounded-lg bg-neutral-200/70 p-0.5" aria-label="Arbeitsschritte">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setStep(s.id)}
                  disabled={!enabled(s.id)}
                  data-testid={`step-${s.id}`}
                  className={`rounded-md px-3 py-1 text-sm transition-colors disabled:opacity-35 sm:px-4 ${
                    step === s.id ? 'bg-white font-medium shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  <span className="mr-1.5 hidden text-xs text-muted sm:inline">{i + 1}</span>
                  {s.label}
                </button>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-3 text-xs text-muted">
            {pages.length > 0 && savedAt && <span className="hidden md:inline">Lokal gesichert</span>}
            {pages.length > 0 && (
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  if (confirm('Neues Projekt beginnen? Alle Seiten und Texte dieses Projekts werden entfernt.')) reset();
                }}
              >
                Neu
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {pages.length === 0 ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-10 sm:px-6">
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Buchseiten zu sauberem PDF</h1>
              <p className="mt-2 text-muted">Fotografieren · Text wortgetreu erkennen · prüfen · als PDF exportieren</p>
            </div>
            <UploadZone />
            <ol className="grid grid-cols-1 gap-3 text-sm text-muted sm:grid-cols-3">
              <li className="card p-4"><span className="font-medium text-ink">1 Seiten</span><br />Sortieren, drehen, zuschneiden, begradigen.</li>
              <li className="card p-4"><span className="font-medium text-ink">2 Text</span><br />Original und Text nebeneinander, unsichere Stellen markiert.</li>
              <li className="card p-4"><span className="font-medium text-ink">3 PDF</span><br />DIN A4, Seiten- und Zeilennummern, durchsuchbar.</li>
            </ol>
          </div>
        ) : step === 'pages' ? (
          <PageManager />
        ) : step === 'editor' ? (
          <Editor />
        ) : (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-muted"><IconSpinner /></div>}>
            <PdfView />
          </Suspense>
        )}
      </main>
    </div>
  );
}
