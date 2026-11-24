import { createWorker, OEM, type Worker } from 'tesseract.js';
import { prepareOcrImage, preprocessForOcr } from './image';
import { computeDewarp } from './dewarp';
import { analyzeOcr, type MarginWords, type OBlock, type OWord } from './analyze';
import type { Page, PageDoc, Settings } from '../types';
import { transformKey } from '../types';

let workerPromise: Promise<Worker> | null = null;
let progressHandler: ((p: number, status: string) => void) | null = null;

const asset = (p: string) => new URL(p, document.baseURI).href;

/** Startet (einmalig) einen lokalen Tesseract-Worker mit deutschem Sprachmodell. */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('deu', OEM.LSTM_ONLY, {
      workerPath: asset('ocr/worker.min.js'),
      corePath: asset('ocr/core'),
      langPath: asset('ocr/lang'),
      gzip: true,
      logger: (m) => {
        if (!progressHandler) return;
        if (m.status === 'recognizing text') progressHandler(0.1 + m.progress * 0.88, 'Text wird erkannt');
        else progressHandler(0.05, m.status === 'loading language traineddata' ? 'Sprachmodell wird geladen' : 'OCR wird vorbereitet');
      },
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export function warmUpOcr() {
  getWorker().catch(() => undefined);
}

/** Führt die Texterkennung für eine Seite aus (Aufrufe werden nacheinander abgearbeitet). */
export async function recognizePage(
  page: Page,
  settings: Pick<Settings, 'preprocess' | 'psm'>,
  onProgress: (p: number, status: string) => void,
): Promise<PageDoc> {
  onProgress(0.02, 'Bild wird vorbereitet');
  let color = await prepareOcrImage(page);
  let clean = preprocessForOcr(color);
  // Gewölbte/schräge Seiten anhand der Textzeilen glätten
  onProgress(0.04, 'Seite wird entzerrt');
  const warp = computeDewarp(clean);
  if (warp) {
    color = warp.apply(color);
    clean = warp.apply(clean);
  }
  const canvas = settings.preprocess ? clean : color;
  const W = canvas.width;
  const H = canvas.height;
  const worker = await getWorker();
  progressHandler = onProgress;
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: settings.psm as never,
      preserve_interword_spaces: '0',
      user_defined_dpi: '300',
    } as never);
    const res = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const raw = (res.data.blocks ?? []) as unknown as OBlock[];
    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as Record<string, unknown>).__ocrRaw = { w: canvas.width, h: canvas.height, blocks: stripRaw(raw) };
    }
    annotateStyles(raw, clean, color);
    if (new URLSearchParams(location.search).has('debug'))
      for (const b of raw)
        for (const p of b.paragraphs)
          for (const l of p.lines) {
            const ws = l.words as unknown as OWord[];
            const sz = (l as unknown as { rowAttributes?: { rowHeight: number } }).rowAttributes?.rowHeight ?? 0;
            console.log('STYLE', Math.round(sz), ws.map((w) => `${w.text}[${(w.stroke! / Math.max(1, sz)).toFixed(3)}|${Math.round(w.chroma!)}|${Math.round(w.confidence)}|${Math.round(w.bbox.x0)}]`).join(' ').slice(0, 260));
          }
    onProgress(0.97, 'Ränder werden geprüft');
    const margins = await scanMargins(worker, canvas, raw);
    if (new URLSearchParams(location.search).has('debug')) console.log('MARGINS', JSON.stringify(margins.map((m) => [m.side, m.words.map((w) => [w.text, Math.round(w.confidence), w.bbox.y0, w.bbox.y1])])));
    await worker.setParameters({ tessedit_pageseg_mode: settings.psm as never } as never);
    const a = analyzeOcr(raw, canvas.width, canvas.height, margins);
    // Zeilenpositionen zurück ins (nicht entzerrte) Seitenbild rechnen
    if (warp) {
      for (const b of a.blocks)
        b.lineBoxes = b.lineBoxes.map((bx) => {
          const pts = [
            warp.toSource(bx.x0 * W, bx.y0 * H),
            warp.toSource(bx.x1 * W, bx.y0 * H),
            warp.toSource(bx.x0 * W, bx.y1 * H),
            warp.toSource(bx.x1 * W, bx.y1 * H),
          ];
          return {
            x0: bx.x0,
            x1: bx.x1,
            y0: Math.max(0, Math.min(...pts.map((p) => p.y)) / H),
            y1: Math.min(1, Math.max(...pts.map((p) => p.y)) / H),
          };
        });
    }
    onProgress(1, 'Fertig');
    return {
      blocks: a.blocks,
      origPageNo: a.origPageNo,
      meanConf: a.meanConf,
      transformKey: transformKey(page),
      edited: false,
      createdAt: Date.now(),
    };
  } finally {
    progressHandler = null;
  }
}

/** Für die Fehlersuche: zyklische Referenzen entfernen. */
function stripRaw(raw: OBlock[]) {
  return raw.map((b) => ({
    bbox: b.bbox,
    paragraphs: b.paragraphs.map((p) => ({
      bbox: p.bbox,
      lines: p.lines.map((l) => ({ bbox: l.bbox, row: (l as unknown as { rowAttributes: unknown }).rowAttributes, words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) })),
    })),
  }));
}

/**
 * Zweiter Durchgang nur über die Seitenränder (Modus „verstreuter Text“):
 * Findet gedruckte Zeilennummern und Seitenzahlen, die die Layoutanalyse
 * als zu klein/isoliert verwirft.
 */
async function scanMargins(worker: Worker, canvas: HTMLCanvasElement, raw: OBlock[]): Promise<MarginWords[]> {
  const W = canvas.width;
  const H = canvas.height;
  const lines = raw.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).filter((l) => l.words.length >= 2);
  if (!lines.length) return [];
  const x0 = Math.min(...lines.map((l) => l.bbox.x0));
  const x1 = Math.max(...lines.map((l) => l.bbox.x1));
  const all = raw.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const y0 = Math.min(...all.map((l) => l.bbox.y0));
  const y1 = Math.max(...all.map((l) => l.bbox.y1));
  const pad = 6;
  const regions: { side: MarginWords['side']; rect: { left: number; top: number; width: number; height: number } }[] = [];
  const medH = median(lines.map((l) => l.bbox.y1 - l.bbox.y0)) || 30;
  const reach = medH * 6; // Zeilennummern stehen nah am Text
  const lx = Math.max(0, x0 - reach);
  if (x0 - pad - lx > 15) regions.push({ side: 'left', rect: { left: lx, top: y0, width: x0 - pad - lx, height: Math.max(1, y1 - y0) } });
  const rx = Math.min(W, x1 + reach);
  if (rx - x1 - pad > 15) regions.push({ side: 'right', rect: { left: x1 + pad, top: y0, width: rx - x1 - pad, height: Math.max(1, y1 - y0) } });
  if (y0 - pad > 25) regions.push({ side: 'top', rect: { left: 0, top: 0, width: W, height: y0 - pad } });
  if (H - y1 - pad > 25) regions.push({ side: 'bottom', rect: { left: 0, top: y1 + pad, width: W, height: H - y1 - pad } });
  if (!regions.length) return [];
  const out: MarginWords[] = [];
  for (const r of regions) {
    const side = r.side === 'left' || r.side === 'right';
    if (side) {
      const words = await readSideNumbers(worker, canvas, r.rect, r.side as 'left' | 'right', medH);
      if (words.length) out.push({ side: r.side, words });
      continue;
    }
    // Ausschnitt mit weißem Rand, vergrößert – einzelne Ziffern werden so zuverlässiger erkannt
    const scale = 2;
    const padC = 24;
    const c = document.createElement('canvas');
    c.width = Math.round(r.rect.width * scale + padC * 2);
    c.height = Math.round(r.rect.height * scale + padC * 2);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, r.rect.left, r.rect.top, r.rect.width, r.rect.height, padC, padC, r.rect.width * scale, r.rect.height * scale);
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '11' as never,
        // an den Seitenrändern interessieren nur Zahlen (Zeilennummern / Seitenzahlen)
        tessedit_char_whitelist: '',
      } as never);
      const res = await worker.recognize(c, {}, { blocks: true, text: false });
      const map = (v: number, o: number) => (v - padC) / scale + o;
      const words: OWord[] = (res.data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) =>
          p.lines.flatMap((l) =>
            l.words.map((w) => ({
              text: w.text,
              confidence: w.confidence,
              bbox: { x0: map(w.bbox.x0, r.rect.left), x1: map(w.bbox.x1, r.rect.left), y0: map(w.bbox.y0, r.rect.top), y1: map(w.bbox.y1, r.rect.top) },
            })),
          ),
        ),
      );
      if (words.length) out.push({ side: r.side, words });
    } catch {
      /* Randprüfung ist optional */
    }
  }
  await worker.setParameters({ tessedit_char_whitelist: '' } as never);
  return out;
}

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

/**
 * Liest gedruckte Zeilennummern in einem schmalen Randstreifen:
 * dunkle Zeilenbänder finden, je Band die textnächste Zeichengruppe ausschneiden
 * und einzeln (nur Ziffern) erkennen.
 */
async function readSideNumbers(
  worker: Worker,
  canvas: HTMLCanvasElement,
  rect: { left: number; top: number; width: number; height: number },
  side: 'left' | 'right',
  medH: number,
): Promise<OWord[]> {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round(rect.left), Math.round(rect.top), w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < dark.length; i += 4, j++) dark[j] = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 150 ? 1 : 0;

  // Zusammenhangskomponenten (4er-Nachbarschaft)
  const label = new Int32Array(w * h);
  type Comp = { x0: number; y0: number; x1: number; y1: number; n: number };
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || label[i]) continue;
    const id = comps.length + 1;
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      const visit = (m: number) => {
        if (dark[m] && !label[m]) {
          label[m] = id;
          stack.push(m);
        }
      };
      if (x > 0) visit(k - 1);
      if (x < w - 1) visit(k + 1);
      if (y > 0) visit(k - w);
      if (y < h - 1) visit(k + w);
    }
    comps.push(c);
  }
  // Kleine Komponenten (auch Bruchstücke einer Ziffer), nicht am Streifenrand
  const glyphs = comps.filter((c) => {
    const ch = c.y1 - c.y0 + 1;
    const cw = c.x1 - c.x0 + 1;
    return ch <= medH * 1.2 && cw <= medH * 1.2 && c.n >= 3 && c.x0 > 1 && c.x1 < w - 2 && c.y0 > 0 && c.y1 < h - 1;
  });
  glyphs.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  // Zu Gruppen (z. B. „10“) zusammenfassen: vertikal überlappend, horizontal nah
  const groupsAll: Comp[] = [];
  for (const g of glyphs) {
    const hit = groupsAll.find(
      (q) =>
        Math.min(q.y1, g.y1) - Math.max(q.y0, g.y0) > -medH * 0.15 &&
        Math.max(q.y1, g.y1) - Math.min(q.y0, g.y0) < medH * 1.2 &&
        g.x0 - q.x1 < medH * 0.45 &&
        q.x0 - g.x1 < medH * 0.45,
    );
    if (hit) {
      hit.x0 = Math.min(hit.x0, g.x0);
      hit.x1 = Math.max(hit.x1, g.x1);
      hit.y0 = Math.min(hit.y0, g.y0);
      hit.y1 = Math.max(hit.y1, g.y1);
      hit.n += g.n;
    } else groupsAll.push({ ...g });
  }

  const words: OWord[] = [];
  for (const grp of groupsAll) {
    const gw = grp.x1 - grp.x0 + 1;
    const bh = grp.y1 - grp.y0 + 1;
    if (gw > medH * 2.6 || bh < medH * 0.3 || grp.n < 15) continue;
    const g: [number, number] = [grp.x0, grp.x1 + 1];
    const by0 = grp.y0;
    const by1 = grp.y1 + 1;
    // Ausschnitt vergrößert erkennen
    const pad = Math.round(medH * 0.5);
    const sx = rect.left + g[0] - pad;
    const sy = rect.top + by0 - pad;
    const sw = gw + pad * 2;
    const sh = bh + pad * 2;
    const scale = Math.max(1, 64 / Math.max(1, bh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
    try {
      // Kontrast des Ausschnitts glätten (reines Schwarz/Weiß hilft bei einzelnen Ziffern)
      const id = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = id.data[i] * 0.3 + id.data[i + 1] * 0.59 + id.data[i + 2] * 0.11 < 150 ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      }
      ctx.putImageData(id, 0, 0);
      // Mehrere Lesarten probieren (Einzelzeichen, Wort, Zeile) und die sicherste nehmen
      const modes = gw < medH * 0.75 ? ['10', '8', '7'] : ['8', '7'];
      let best = { t: '', conf: -1 };
      for (const m of modes) {
        await worker.setParameters({ tessedit_pageseg_mode: m as never, tessedit_char_whitelist: '0123456789' } as never);
        const res = await worker.recognize(c, {}, { text: true, blocks: false });
        const t = res.data.text.trim();
        if (/^\d{1,3}$/.test(t) && res.data.confidence > best.conf) best = { t, conf: res.data.confidence };
        if (best.conf >= 85) break;
      }
      if (new URLSearchParams(location.search).has('debug')) console.log('MARGINS side', side, by0, by1, g[0], g[1], JSON.stringify(best.t), best.conf);
      if (best.t && best.conf >= 10) {
        words.push({
          text: best.t,
          confidence: best.conf,
          bbox: { x0: rect.left + g[0], x1: rect.left + g[1], y0: rect.top + by0, y1: rect.top + by1 },
        });
      }
    } catch {
      /* einzelne Zahl nicht lesbar – ignorieren */
    }
  }
  return words;
}

/**
 * Misst je Wort Strichstärke (mittlere Länge waagerechter Tintenläufe) und Farbigkeit der
 * Tinte. Daraus erkennt die Analyse fette und farbige Überschriften.
 */
function annotateStyles(raw: OBlock[], clean: HTMLCanvasElement, color: HTMLCanvasElement) {
  const W = clean.width;
  const H = clean.height;
  const g = clean.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const c = color.width === W && color.height === H ? color.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data : null;
  for (const b of raw)
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words) {
          const x0 = Math.max(0, Math.floor(w.bbox.x0));
          const x1 = Math.min(W - 1, Math.ceil(w.bbox.x1));
          const y0 = Math.max(0, Math.floor(w.bbox.y0));
          const y1 = Math.min(H - 1, Math.ceil(w.bbox.y1));
          const ww = x1 - x0 + 1;
          const hh = y1 - y0 + 1;
          if (ww <= 0 || hh <= 0) continue;
          const dark = new Uint8Array(ww * hh);
          for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) dark[y * ww + x] = g[((y + y0) * W + x + x0) * 4] < 128 ? 1 : 0;
          // Lauflängen waagerecht und senkrecht je Tintenpixel; Strichdicke = kürzere der beiden
          const hr = new Uint16Array(ww * hh);
          for (let y = 0; y < hh; y++) {
            let x = 0;
            while (x < ww) {
              if (!dark[y * ww + x]) { x++; continue; }
              let e = x;
              while (e < ww && dark[y * ww + e]) e++;
              for (let k = x; k < e; k++) hr[y * ww + k] = e - x;
              x = e;
            }
          }
          const hist = new Uint32Array(64);
          let ink = 0;
          let chroma = 0;
          for (let x = 0; x < ww; x++) {
            let y = 0;
            while (y < hh) {
              if (!dark[y * ww + x]) { y++; continue; }
              let e = y;
              while (e < hh && dark[e * ww + x]) e++;
              for (let k = y; k < e; k++) {
                const m = Math.min(63, Math.min(hr[k * ww + x], e - y));
                hist[m]++;
                ink++;
                if (c) {
                  const i = ((k + y0) * W + x + x0) * 4;
                  chroma += Math.max(c[i], c[i + 1], c[i + 2]) - Math.min(c[i], c[i + 1], c[i + 2]);
                }
              }
              y = e;
            }
          }
          let acc = 0;
          let med = 0;
          for (; med < 64; med++) {
            acc += hist[med];
            if (acc >= ink / 2) break;
          }
          // Mittelwert der Strichdicke (stabiler als der ganzzahlige Median)
          let sum = 0;
          for (let m = 0; m < 64; m++) sum += m * hist[m];
          const ow = w as unknown as OWord;
          ow.stroke = ink ? sum / ink : 0;
          ow.chroma = ink ? chroma / ink : 0;
        }
}
