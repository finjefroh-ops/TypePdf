import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { Block, Page, PageDoc, Settings, Step } from './types';
import { defaultSettings, transformKey } from './types';
import { newId } from './lib/analyze';
import { loadBitmap, naturalCompare, renderTransformed, canvasToBlob } from './lib/image';
import { recognizePage } from './lib/ocr';

interface State {
  hydrated: boolean;
  step: Step;
  pages: Page[];
  thumbs: Record<string, string>;
  settings: Settings;
  activePageId: string | null;
  ocrRunning: boolean;
  ocrStatus: string;
  savedAt: number | null;

  setStep: (s: Step) => void;
  addFiles: (files: File[]) => Promise<void>;
  removePage: (id: string) => void;
  replaceImage: (id: string, file: File) => Promise<void>;
  reorder: (ids: string[]) => void;
  sortByName: () => void;
  sortByPageNo: () => void;
  updateTransform: (id: string, t: Partial<Pick<Page, 'rotation' | 'skew' | 'crop'>>) => void;
  setActive: (id: string | null) => void;
  updatePage: (id: string, patch: Partial<Page>) => void;
  setBlocks: (pageId: string, blocks: Block[]) => void;
  updateSettings: (s: Partial<Settings>) => void;
  runOcr: (ids?: string[], force?: boolean) => Promise<void>;
  cancelOcr: () => void;
  reset: () => void;
}

let cancelRequested = false;

const blobOf = async (f: File): Promise<{ blob: Blob; width: number; height: number }> => {
  const bmp = await loadBitmap(f);
  return { blob: f, width: bmp.width, height: bmp.height };
};

async function makeThumb(p: Page): Promise<string> {
  const c = await renderTransformed(p, 520);
  const b = await canvasToBlob(c, 'image/jpeg', 0.8);
  return URL.createObjectURL(b);
}

export const useStore = create<State>((set, get) => {
  const refreshThumb = async (id: string) => {
    const p = get().pages.find((x) => x.id === id);
    if (!p) return;
    try {
      const url = await makeThumb(p);
      const old = get().thumbs[id];
      if (old) URL.revokeObjectURL(old);
      set((s) => ({ thumbs: { ...s.thumbs, [id]: url } }));
    } catch {
      /* Vorschaubild optional */
    }
  };

  return {
    hydrated: false,
    step: 'pages',
    pages: [],
    thumbs: {},
    settings: defaultSettings,
    activePageId: null,
    ocrRunning: false,
    ocrStatus: '',
    savedAt: null,

    setStep: (step) => set({ step }),

    addFiles: async (files) => {
      const sorted = [...files].sort((a, b) => naturalCompare(a.name, b.name));
      const added: Page[] = [];
      for (const f of sorted) {
        try {
          const { blob, width, height } = await blobOf(f);
          added.push({
            id: newId('p'),
            name: f.name,
            blob,
            width,
            height,
            rotation: 0,
            skew: 0,
            crop: null,
            doc: null,
            status: 'idle',
            progress: 0,
            joinWithPrevious: false,
            continueParagraph: false,
          });
        } catch {
          alert(`„${f.name}“ konnte nicht gelesen werden.`);
        }
      }
      set((s) => ({ pages: [...s.pages, ...added], activePageId: s.activePageId ?? added[0]?.id ?? null }));
      for (const p of added) await refreshThumb(p.id);
    },

    removePage: (id) => {
      const old = get().thumbs[id];
      if (old) URL.revokeObjectURL(old);
      set((s) => {
        const pages = s.pages.filter((p) => p.id !== id);
        const thumbs = { ...s.thumbs };
        delete thumbs[id];
        return { pages, thumbs, activePageId: s.activePageId === id ? (pages[0]?.id ?? null) : s.activePageId };
      });
    },

    replaceImage: async (id, file) => {
      const { blob, width, height } = await blobOf(file);
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === id
            ? {
                ...p,
                name: file.name,
                blob,
                width,
                height,
                rotation: 0,
                skew: 0,
                crop: null,
                // vorhandener Text bleibt erhalten, gilt aber als veraltet
                doc: p.doc ? { ...p.doc, transformKey: 'ersetzt' } : null,
                status: p.doc ? 'done' : 'idle',
              }
            : p,
        ),
      }));
      await refreshThumb(id);
    },

    reorder: (ids) =>
      set((s) => ({ pages: ids.map((id) => s.pages.find((p) => p.id === id)!).filter(Boolean) })),

    sortByName: () => set((s) => ({ pages: [...s.pages].sort((a, b) => naturalCompare(a.name, b.name)) })),

    sortByPageNo: () =>
      set((s) => {
        const num = (p: Page) => {
          const n = p.doc?.origPageNo;
          if (!n) return Infinity;
          const v = parseInt(n, 10);
          return Number.isFinite(v) ? v : Infinity;
        };
        // stabile Sortierung: Seiten ohne Nummer bleiben relativ an ihrem Platz hinter den nummerierten
        return { pages: [...s.pages].map((p, i) => ({ p, i })).sort((a, b) => num(a.p) - num(b.p) || a.i - b.i).map((x) => x.p) };
      }),

    updateTransform: (id, t) => {
      set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...t } : p)) }));
      refreshThumb(id);
    },

    setActive: (activePageId) => set({ activePageId }),

    updatePage: (id, patch) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

    setBlocks: (pageId, blocks) =>
      set((s) => ({
        pages: s.pages.map((p) => (p.id === pageId && p.doc ? { ...p, doc: { ...p.doc, blocks, edited: true } } : p)),
      })),

    updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

    runOcr: async (ids, force = false) => {
      if (get().ocrRunning) return;
      const targets = (ids ?? get().pages.map((p) => p.id)).filter((id) => {
        const p = get().pages.find((x) => x.id === id);
        if (!p) return false;
        if (force) return true;
        return !p.doc || p.status === 'error';
      });
      if (!targets.length) return;
      cancelRequested = false;
      set((s) => ({
        ocrRunning: true,
        pages: s.pages.map((p) => (targets.includes(p.id) ? { ...p, status: 'queued', progress: 0, error: undefined } : p)),
      }));
      for (const id of targets) {
        if (cancelRequested) break;
        const page = get().pages.find((p) => p.id === id);
        if (!page) continue;
        get().updatePage(id, { status: 'running', progress: 0 });
        try {
          const doc: PageDoc = await recognizePage(page, get().settings, (progress, status) => {
            set((s) => ({ ocrStatus: status, pages: s.pages.map((p) => (p.id === id ? { ...p, progress } : p)) }));
          });
          get().updatePage(id, { doc, status: 'done', progress: 1 });
        } catch (e) {
          console.error(e);
          get().updatePage(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }
      set((s) => ({
        ocrRunning: false,
        ocrStatus: '',
        pages: s.pages.map((p) => (p.status === 'queued' ? { ...p, status: p.doc ? 'done' : 'idle' } : p)),
      }));
    },

    cancelOcr: () => {
      cancelRequested = true;
    },

    reset: () => {
      Object.values(get().thumbs).forEach((u) => URL.revokeObjectURL(u));
      set({ pages: [], thumbs: {}, activePageId: null, step: 'pages', settings: { ...defaultSettings } });
      idbDel(STORAGE_KEY).catch(() => undefined);
    },
  };
});

/** Ist die OCR einer Seite noch auf dem aktuellen Bildstand? */
export const isStale = (p: Page) => !!p.doc && p.doc.transformKey !== transformKey(p);

/* ---------- Lokale Sicherung (IndexedDB, bleibt im Browser) ---------- */

const STORAGE_KEY = 'typepdf-project-v1';

interface Persisted {
  pages: Omit<Page, 'status' | 'progress'>[];
  settings: Settings;
  activePageId: string | null;
  step: Step;
}

export async function hydrate() {
  try {
    const data = (await idbGet(STORAGE_KEY)) as Persisted | undefined;
    if (data?.pages?.length) {
      const pages: Page[] = data.pages.map((p) => ({ ...p, status: p.doc ? 'done' : 'idle', progress: p.doc ? 1 : 0 }));
      useStore.setState({
        pages,
        settings: { ...defaultSettings, ...data.settings },
        activePageId: data.activePageId,
        step: data.step ?? 'pages',
      });
      for (const p of pages) {
        makeThumb(p)
          .then((url) => useStore.setState((s) => ({ thumbs: { ...s.thumbs, [p.id]: url } })))
          .catch(() => undefined);
      }
    } else if (data?.settings) {
      useStore.setState({ settings: { ...defaultSettings, ...data.settings } });
    }
  } catch (e) {
    console.warn('Wiederherstellung nicht möglich', e);
  }
  useStore.setState({ hydrated: true });

  let timer: number | undefined;
  let lastPages: Page[] | null = null;
  let lastSettings: Settings | null = null;
  let lastActive: string | null = null;
  let lastStep: Step | null = null;
  useStore.subscribe((s) => {
    if (s.pages === lastPages && s.settings === lastSettings && s.activePageId === lastActive && s.step === lastStep) return;
    lastPages = s.pages;
    lastSettings = s.settings;
    lastActive = s.activePageId;
    lastStep = s.step;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 600);
  });
}

async function save() {
  const s = useStore.getState();
  const data: Persisted = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pages: s.pages.map(({ status: _s, progress: _p, ...rest }) => rest),
    settings: s.settings,
    activePageId: s.activePageId,
    step: s.step,
  };
  try {
    await idbSet(STORAGE_KEY, data);
    useStore.setState({ savedAt: Date.now() });
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
  }
}

export const flushSave = save;
