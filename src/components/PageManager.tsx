import { useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isStale, useStore } from '../store';
import type { Page, Rotation } from '../types';
import { UploadZone } from './UploadZone';
import { Switch } from './Switch';
import { ImageEditor } from './ImageEditor';
import { IconEdit, IconGrip, IconReplace, IconRotateLeft, IconRotateRight, IconSpinner, IconTrash, IconWarn } from './Icons';

/** Zeitpunkt des letzten Ziehens – verhindert, dass nach dem Loslassen der Bildeditor aufgeht. */
let lastDragEnd = 0;

export function PageManager() {
  const pages = useStore((s) => s.pages);
  const reorder = useStore((s) => s.reorder);
  const sortByName = useStore((s) => s.sortByName);
  const sortByPageNo = useStore((s) => s.sortByPageNo);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const runOcr = useStore((s) => s.runOcr);
  const ocrRunning = useStore((s) => s.ocrRunning);
  const setStep = useStore((s) => s.setStep);
  const [editing, setEditing] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    lastDragEnd = Date.now();
    if (!e.over || e.active.id === e.over.id) return;
    const ids = pages.map((p) => p.id);
    reorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };

  const withPageNo = pages.filter((p) => p.doc?.origPageNo).length;
  const pending = pages.filter((p) => !p.doc || p.status === 'error').length;
  const done = pages.filter((p) => p.doc).length;

  const start = async () => {
    setStep('editor');
    await runOcr();
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Seiten</h1>
          <p className="text-sm text-muted">
            {pages.length} {pages.length === 1 ? 'Seite' : 'Seiten'} · Reihenfolge per Ziehen ändern · Bild antippen zum Drehen, Zuschneiden und Begradigen
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={sortByName} title="Nach Dateiname sortieren (natürliche Reihenfolge)">
            Nach Dateiname
          </button>
          <button
            className="btn"
            onClick={sortByPageNo}
            disabled={withPageNo < 2}
            title={withPageNo < 2 ? 'Verfügbar, sobald auf mindestens zwei Seiten eine Seitenzahl erkannt wurde' : 'Nach erkannten Buchseitenzahlen sortieren'}
          >
            Nach Seitenzahl
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        onDragCancel={() => (lastDragEnd = Date.now())}
      >
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {pages.map((p, i) => (
              <PageCard key={p.id} page={p} index={i} onEdit={() => setEditing(p.id)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <UploadZone compact />

      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Layout</span>
            <select
              className="field py-1"
              value={settings.psm}
              onChange={(e) => updateSettings({ psm: e.target.value as typeof settings.psm })}
            >
              <option value="3">Automatisch (mehrspaltig)</option>
              <option value="4">Einspaltig</option>
              <option value="6">Ein Textblock</option>
            </select>
          </label>
          <div className="w-56">
            <Switch checked={settings.preprocess} onChange={(v) => updateSettings({ preprocess: v })} label="Beleuchtung ausgleichen" testId="sw-preprocess" />
          </div>
          <div className="w-56">
            <Switch
              checked={settings.autocorrect}
              onChange={(v) => updateSettings({ autocorrect: v })}
              label="Autokorrektur"
              hint="eindeutige Lesefehler, bleibt markiert"
              testId="sw-autocorrect"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {done > 0 && (
            <button className="btn" onClick={() => setStep('editor')}>
              Zum Editor
            </button>
          )}
          <button className="btn-primary" onClick={start} disabled={!pages.length || ocrRunning} data-testid="start-ocr">
            {ocrRunning ? <IconSpinner /> : null}
            {pending === 0 && done ? 'Text bearbeiten' : `Texterkennung starten${pending && done ? ` (${pending} neu)` : ''}`}
          </button>
        </div>
      </div>

      {editing && <ImageEditor pageId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PageCard({ page, index, onEdit }: { page: Page; index: number; onEdit: () => void }) {
  const thumb = useStore((s) => s.thumbs[page.id]);
  const removePage = useStore((s) => s.removePage);
  const replaceImage = useStore((s) => s.replaceImage);
  const updateTransform = useStore((s) => s.updateTransform);
  const fileInput = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });

  const rotate = (d: number) => updateTransform(page.id, { rotation: (((page.rotation + d) % 360) + 360) % 360 as Rotation });
  const stale = isStale(page);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`card group flex flex-col overflow-hidden ${isDragging ? 'shadow-lg ring-1 ring-neutral-300' : ''}`}
      data-testid="page-card"
    >
      <div
        className="relative aspect-[3/4] cursor-grab touch-none bg-neutral-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        onClick={() => Date.now() - lastDragEnd > 300 && onEdit()}
      >
        {thumb ? (
          <img src={thumb} alt={page.name} className="h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted"><IconSpinner /></div>
        )}
        <span className="absolute left-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium shadow-sm">{index + 1}</span>
        <span className="absolute right-2 top-2 rounded bg-white/90 p-1 text-muted opacity-70 shadow-sm"><IconGrip width={12} height={12} /></span>
        {page.status === 'running' || page.status === 'queued' ? (
          <div className="absolute inset-x-0 bottom-0 bg-white/90 px-2 py-1.5">
            <div className="h-1 overflow-hidden rounded bg-neutral-200">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(page.progress * 100)}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="truncate text-xs text-muted" title={page.name}>{page.name}</div>
        <div className="flex min-h-5 flex-wrap items-center gap-1 text-[11px]">
          {page.doc && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-ink">OCR {Math.round(page.doc.meanConf)} %</span>
          )}
          {page.doc?.origPageNo && <span className="rounded bg-neutral-100 px-1.5 py-0.5">S. {page.doc.origPageNo}</span>}
          {page.status === 'error' && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">Fehler</span>}
          {stale && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800" title="Bild wurde nach der Texterkennung geändert">
              <IconWarn width={11} height={11} /> Bild geändert
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex">
            <button className="btn-ghost px-1.5" title="Links drehen" onClick={() => rotate(-90)}><IconRotateLeft /></button>
            <button className="btn-ghost px-1.5" title="Rechts drehen" onClick={() => rotate(90)}><IconRotateRight /></button>
            <button className="btn-ghost px-1.5" title="Zuschneiden & begradigen" onClick={onEdit} data-testid="edit-image"><IconEdit /></button>
          </div>
          <div className="flex">
            <button className="btn-ghost px-1.5" title="Bild ersetzen" onClick={() => fileInput.current?.click()}><IconReplace /></button>
            <button
              className="btn-ghost px-1.5 hover:text-red-700"
              title="Seite entfernen"
              onClick={() => {
                if (page.doc?.edited && !confirm('Diese Seite enthält bearbeiteten Text. Wirklich entfernen?')) return;
                removePage(page.id);
              }}
            >
              <IconTrash />
            </button>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) replaceImage(page.id, f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
