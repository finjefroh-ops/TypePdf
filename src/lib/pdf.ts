/**
 * PDF-Satz: erzeugt ein schlichtes, typografisch sauberes DIN-A4-Dokument
 * mit echtem (durchsuchbarem, markierbarem) Text. Der Text wird 1:1 übernommen.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Block, Page, Settings } from '../types';

export interface FontBytes {
  regular: Uint8Array | ArrayBuffer;
  bold: Uint8Array | ArrayBuffer;
  italic: Uint8Array | ArrayBuffer;
}

export interface PageImage {
  bytes: Uint8Array | ArrayBuffer;
  width: number;
  height: number;
}

export type ImageProvider = (page: Page) => Promise<PageImage>;

const MM = 72 / 25.4;
const A4_W = 595.28;
const A4_H = 841.89;
const M_TOP = 25 * MM;
const M_BOTTOM = 25 * MM;
const M_LEFT = 25 * MM;
const M_RIGHT = 20 * MM;
const BLACK = rgb(0, 0, 0);

type Kind = 'h1' | 'h2' | 'p' | 'footnote';
interface SrcLine {
  text: string;
  origNo: string | null;
}
interface Item {
  kind: Kind;
  lines: SrcLine[];
  srcIndex: number;
  newPageBefore: boolean;
}

/** Steuerzeichen entfernen, Tabs zu Leerzeichen – sonst unverändert. */
const sanitize = (t: string) => t.replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');

/**
 * Fließtext aus Vorlagenzeilen: Zeilen werden mit Leerzeichen verbunden, am Zeilenende
 * getrennte Wörter (Silbentrennung „Wort-\nteil“ mit kleinem Folgebuchstaben) wieder zusammengefügt.
 */
export function joinLinesFlow(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!out) out = l;
    else if (/[A-Za-zÄÖÜäöüß]-$/.test(out) && /^[a-zäöüß]/.test(l)) out = out.slice(0, -1) + l;
    else out += ' ' + l;
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxW: number, firstIndent = 0, restIndent = 0): string[] {
  const words = text.split(/ +/).filter((w) => w.length);
  if (!words.length) return [''];
  const lines: string[] = [];
  let cur = '';
  const avail = () => maxW - (lines.length === 0 ? firstIndent : restIndent);
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  for (let w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (width(cand) <= avail()) {
      cur = cand;
      continue;
    }
    if (cur) {
      lines.push(cur);
      cur = '';
    }
    // Überlange Wörter (z. B. URLs) zeichenweise umbrechen
    while (width(w) > avail()) {
      let i = w.length - 1;
      while (i > 1 && width(w.slice(0, i)) > avail()) i--;
      lines.push(w.slice(0, i));
      w = w.slice(i);
    }
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface RangeHit {
  pageIndex: number;
  blockId: string;
  preview: string;
}
export interface RangeResult {
  start: RangeHit | null;
  end: RangeHit | null;
  /** Begriff eingegeben, aber nicht gefunden */
  startMissing: boolean;
  endMissing: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sucht den Bereich für das PDF („ab M5“ / „bis M7“). Bevorzugt Abschnitte, die mit dem
 * Begriff beginnen (z. B. Überschrift „M5 …“), sonst das erste Vorkommen als ganzes Wort.
 * Das Ende ist exklusiv: der gefundene End-Abschnitt gehört nicht mehr dazu.
 */
export function findRange(pages: Page[], startTerm: string, endTerm: string): RangeResult {
  const seq: { pageIndex: number; b: Block; text: string }[] = [];
  pages.forEach((p, pageIndex) =>
    p.doc?.blocks.forEach((b) => {
      if (b.type !== 'hidden' && b.text.trim()) seq.push({ pageIndex, b, text: b.text.replace(/\s+/g, ' ').trim() });
    }),
  );
  const find = (term: string, from: number) => {
    const t = term.replace(/\s+/g, ' ').trim();
    if (!t) return -1;
    const atStart = new RegExp(`^[^\\p{L}\\p{N}]*${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'iu');
    const anywhere = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'iu');
    for (let i = from; i < seq.length; i++) if (atStart.test(seq[i].text)) return i;
    for (let i = from; i < seq.length; i++) if (anywhere.test(seq[i].text)) return i;
    return -1;
  };
  const hit = (i: number): RangeHit | null =>
    i < 0 ? null : { pageIndex: seq[i].pageIndex, blockId: seq[i].b.id, preview: seq[i].text.slice(0, 60) };
  const si = find(startTerm, 0);
  const ei = find(endTerm, si < 0 ? 0 : si + 1);
  return {
    start: hit(si),
    end: hit(ei),
    startMissing: !!startTerm.trim() && si < 0,
    endMissing: !!endTerm.trim() && ei < 0,
  };
}

function buildItems(pages: Page[], settings: Settings): Item[] {
  const items: Item[] = [];
  let firstWithContent = true;
  const range = findRange(pages, settings.rangeStart ?? '', settings.rangeEnd ?? '');
  let inside = !range.start; // ohne Startbegriff: von Anfang an
  let done = false;
  pages.forEach((page, srcIndex) => {
    if (!page.doc || done) return;
    const blocks = page.doc.blocks.filter((b) => {
      if (done) return false;
      if (range.end && b.id === range.end.blockId) {
        done = true;
        return false;
      }
      if (!inside && range.start && b.id === range.start.blockId) inside = true;
      return inside && b.type !== 'hidden' && b.text.trim().length;
    });
    blocks.forEach((b: Block, bi) => {
      const raw = b.text.split('\n');
      let lines: SrcLine[] = raw.map((t, i) => ({ text: sanitize(t), origNo: b.lineNos[i] ?? null }));
      if (settings.lineBreaks === 'flow' || b.type === 'h1' || b.type === 'h2') {
        lines = [{ text: joinLinesFlow(lines.map((l) => l.text)), origNo: lines.find((l) => l.origNo)?.origNo ?? null }];
      }
      const kind = b.type as Kind;
      const isFirst = bi === 0;
      const newPageBefore =
        !firstWithContent &&
        ((isFirst && settings.pageBreakPerSource && !page.joinWithPrevious) || !!b.pageBreakBefore);
      const prev = items[items.length - 1];
      if (isFirst && page.continueParagraph && kind === 'p' && prev && prev.kind === 'p' && !newPageBefore) {
        if (settings.lineBreaks === 'flow') prev.lines[0].text = joinLinesFlow([prev.lines[0].text, lines[0].text]);
        else prev.lines.push(...lines);
      } else {
        items.push({ kind, lines, srcIndex, newPageBefore });
      }
      firstWithContent = false;
    });
  });
  return items;
}

export async function buildPdf(
  pages: Page[],
  settings: Settings,
  fonts: FontBytes,
  images?: ImageProvider,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const title = settings.fileName.trim() || 'Dokument';
  pdf.setTitle(title);
  pdf.setCreator('TYPEPDF');
  pdf.setProducer('TYPEPDF');
  pdf.setLanguage('de-DE');
  pdf.setCreationDate(new Date());

  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const italic = await pdf.embedFont(fonts.italic, { subset: true });

  if (settings.pdfMode === 'image') {
    if (!images) throw new Error('Keine Bildquelle für den Bildmodus');
    await buildImagePdf(pdf, pages, regular, images, settings);
  } else {
    layoutText(pdf, pages, settings, { regular, bold, italic });
  }
  if (pdf.getPageCount() === 0) pdf.addPage([A4_W, A4_H]);
  return pdf.save({ useObjectStreams: true });
}

function layoutText(
  pdf: PDFDocument,
  pages: Page[],
  settings: Settings,
  f: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
) {
  const size = settings.fontSize;
  const leading = size * 1.45;
  const contentW = A4_W - M_LEFT - M_RIGHT;
  const bottomLimit = M_BOTTOM;
  const items = buildItems(pages, settings);

  const style = {
    h1: { font: f.bold, size: size * 1.45, leading: size * 1.45 * 1.25, before: leading * 1.3, after: leading * 0.5 },
    h2: { font: f.bold, size: size * 1.15, leading: size * 1.15 * 1.3, before: leading * 0.9, after: leading * 0.3 },
    p: { font: f.regular, size, leading, before: size * 0.6, after: 0 },
    footnote: { font: f.regular, size: size * 0.82, leading: size * 0.82 * 1.4, before: size * 0.3, after: 0 },
  } as const;

  const outPages: { page: PDFPage; srcIndex: number | null }[] = [];
  const cur = () => outPages[outPages.length - 1]?.page;
  let y = 0;
  let atTop = true;
  let lineCounter = 0;

  const newPage = () => {
    outPages.push({ page: pdf.addPage([A4_W, A4_H]), srcIndex: null });
    y = A4_H - M_TOP;
    atTop = true;
    if (settings.lineNumbers === 'page') lineCounter = 0;
  };
  const markSource = (srcIndex: number) => {
    const op = outPages[outPages.length - 1];
    if (op.srcIndex === null) op.srcIndex = srcIndex;
  };

  const numSize = 8;
  const drawLineNo = (label: string, baseline: number, isOriginal: boolean) => {
    const font = isOriginal ? f.italic : f.regular;
    const w = font.widthOfTextAtSize(label, numSize);
    cur().drawText(label, { x: M_LEFT - 5 * MM - w, y: baseline, size: numSize, font, color: BLACK });
  };

  let prevKind: Kind | null = null;
  for (const it of items) {
    const st = style[it.kind];
    if (!cur() || it.newPageBefore) newPage();
    const indentRest = settings.lineBreaks === 'original' && it.kind !== 'h1' && it.kind !== 'h2' ? size * 1.2 : 0;

    // Visuelle Zeilen berechnen
    const visual: { text: string; origNo: string | null; first: boolean; indent: number }[] = [];
    for (const sl of it.lines) {
      const wrapped = wrap(sl.text, st.font, st.size, contentW, 0, indentRest);
      wrapped.forEach((t, i) => visual.push({ text: t, origNo: i === 0 ? sl.origNo : null, first: i === 0, indent: i === 0 ? 0 : indentRest }));
    }
    if (!visual.length) continue;

    // Abstand vor dem Block
    let before = atTop ? 0 : st.before;
    const footRule = it.kind === 'footnote' && prevKind !== 'footnote';
    if (footRule && !atTop) before = leading * 0.9;
    if (it.kind === 'p' && prevKind && (prevKind === 'h1' || prevKind === 'h2')) before = 0;

    // Überschriften mit folgendem Text zusammenhalten, keine einzelne erste Zeile am Seitenende
    const need =
      it.kind === 'h1' || it.kind === 'h2'
        ? before + visual.length * st.leading + st.after + leading * 2
        : before + Math.min(visual.length, 2) * st.leading;
    if (!atTop && y - need < bottomLimit) newPage();
    if (!atTop) y -= before;

    if (footRule) {
      const ry = y - 2;
      cur().drawLine({ start: { x: M_LEFT, y: ry }, end: { x: M_LEFT + 40 * MM, y: ry }, thickness: 0.4, color: BLACK });
      y -= 4;
    }

    for (let i = 0; i < visual.length; i++) {
      if (y - st.leading < bottomLimit) {
        newPage();
      }
      const v = visual[i];
      const baseline = y - st.size * 0.95 - (st.leading - st.size * 1.2) / 2;
      cur().drawText(v.text, { x: M_LEFT + v.indent, y: baseline, size: st.size, font: st.font, color: BLACK });
      markSource(it.srcIndex);
      if (it.kind === 'p') {
        if (settings.lineNumbers === 'page' || settings.lineNumbers === 'document') {
          lineCounter++;
          if (lineCounter % settings.lineNumberInterval === 0) drawLineNo(String(lineCounter), baseline, false);
        } else if (settings.lineNumbers === 'original' && v.origNo) {
          drawLineNo(v.origNo, baseline, true);
        }
      } else if (settings.lineNumbers === 'original' && v.origNo && it.kind !== 'footnote') {
        drawLineNo(v.origNo, baseline, true);
      }
      y -= st.leading;
      atTop = false;
    }
    y -= st.after;
    prevKind = it.kind;
  }

  // Seitenzahlen
  if (settings.pageNumbers !== 'none') {
    outPages.forEach((op, i) => {
      let label: string | null = String(i + 1);
      if (settings.pageNumberSource === 'original') {
        label = op.srcIndex !== null ? (pages[op.srcIndex].doc?.origPageNo ?? null) : null;
      }
      if (!label) return;
      const s = 9;
      const w = f.regular.widthOfTextAtSize(label, s);
      const x = settings.pageNumbers === 'center' ? (A4_W - w) / 2 : A4_W - M_RIGHT - w;
      op.page.drawText(label, { x, y: 12 * MM, size: s, font: f.regular, color: BLACK });
    });
  }
}

/** Originalbild je Seite mit unsichtbarer, durchsuchbarer Textebene. */
async function buildImagePdf(pdf: PDFDocument, allPages: Page[], font: PDFFont, images: ImageProvider, settings: Settings) {
  // Bereich seitenweise: von der Seite mit dem Startbegriff bis zur Seite mit dem Endbegriff
  const r = findRange(allPages, settings.rangeStart ?? '', settings.rangeEnd ?? '');
  const first = r.start?.pageIndex ?? 0;
  const last = r.end ? r.end.pageIndex : allPages.length - 1;
  const pages = allPages.slice(first, last + 1);
  for (const p of pages) {
    const img = await images(p);
    const embedded = await pdf.embedJpg(img.bytes);
    const landscape = img.width > img.height;
    const W = landscape ? A4_H : A4_W;
    const H = landscape ? A4_W : A4_H;
    const page = pdf.addPage([W, H]);
    const scale = Math.min(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    page.drawImage(embedded, { x: ox, y: oy, width: dw, height: dh });
    if (!p.doc) continue;
    for (const b of p.doc.blocks) {
      const lines = b.text.split('\n');
      lines.forEach((raw, i) => {
        const text = sanitize(raw).trim();
        if (!text) return;
        const box = b.lineBoxes[Math.min(i, b.lineBoxes.length - 1)];
        if (!box) return;
        const bw = (box.x1 - box.x0) * dw;
        const bh = (box.y1 - box.y0) * dh;
        const w1 = font.widthOfTextAtSize(text, 1);
        if (w1 <= 0 || bw <= 0) return;
        const fs = Math.max(1, Math.min(bw / w1, bh * 1.6));
        const x = ox + box.x0 * dw;
        const yb = oy + dh - box.y1 * dh + bh * 0.2;
        page.drawText(text, { x, y: yb, size: fs, font, opacity: 0 });
      });
    }
  }
}
