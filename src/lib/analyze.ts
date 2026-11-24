/**
 * Wandelt die Rohdaten der OCR (Blöcke → Absätze → Zeilen → Wörter) in
 * editierbare Textblöcke um. Der erkannte Text wird dabei NICHT umformuliert
 * oder korrigiert: es werden nur Struktur (Überschrift, Absatz, Fußnote),
 * Seitenzahlen und gedruckte Zeilennummern erkannt und unsichere Wörter markiert.
 */
import type { Block, BlockType, Box, Mark } from '../types';

export interface OBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OWord {
  text: string;
  confidence: number;
  bbox: OBox;
  /** mittlere Strichstärke in Pixeln (aus dem Bild gemessen) – Hinweis auf Fettdruck */
  stroke?: number;
  /** mittlere Farbigkeit der Schrift (0 = grau/schwarz) – Hinweis auf farbige Überschriften */
  chroma?: number;
}
export interface OLine {
  words: OWord[];
  bbox: OBox;
  rowAttributes?: { rowHeight: number; ascenders: number; descenders: number };
}

/** Zusätzlich in den Seitenrändern gefundene Wörter (zweiter, gezielter OCR-Durchgang). */
export interface MarginWords {
  side: 'left' | 'right' | 'top' | 'bottom';
  words: OWord[];
}
export interface OPara {
  lines: OLine[];
  bbox: OBox;
}
export interface OBlock {
  paragraphs: OPara[];
  bbox: OBox;
}

export interface AnalyzeResult {
  blocks: Block[];
  origPageNo: string | null;
  meanConf: number;
}

/** Wörter unter dieser Konfidenz werden als Markierung gespeichert (Anzeige filtert nach Schwelle). */
const STORE_MARK_BELOW = 93;

let idCounter = 0;
export const newId = (prefix = 'b') => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Unicode-Ligaturen auflösen (reine Darstellungsform, kein inhaltlicher Eingriff). */
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
export const cleanWord = (t: string) => t.normalize('NFC').replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c);

const isNumberToken = (t: string) => /^\d{1,3}$/.test(t);
const PAGE_NO_RE = /^[-–—\s[(]*(?:S\.|Seite)?\s*(\d{1,4}|[ivxlcdm]{1,7})\s*[-–—\s\])]*$/i;

interface WLine {
  words: OWord[];
  bbox: OBox;
  lineNo: string | null;
  /** Schriftgröße (Zeilenhöhe laut OCR) */
  size: number;
  /** Auszeichnung: fett / farbig */
  bold?: boolean;
  colored?: boolean;
}

const lineH = (l: { bbox: OBox }) => l.bbox.y1 - l.bbox.y0;
const sizeOf = (l: OLine) => (l.rowAttributes?.rowHeight && l.rowAttributes.rowHeight > 0 ? l.rowAttributes.rowHeight : l.bbox.y1 - l.bbox.y0);
const textOf = (l: WLine) => l.words.map((w) => cleanWord(w.text)).join(' ');

export function analyzeOcr(input: OBlock[], imgW: number, imgH: number, margins: MarginWords[] = []): AnalyzeResult {
  // 1. Alle Absätze mit nicht-leeren Wörtern sammeln
  type P = { lines: WLine[]; blk?: number };
  let paras: P[] = [];
  for (const [bi, b] of input.entries())
    for (const p of b.paragraphs) {
      const lines: WLine[] = p.lines
        .map((l) => ({ words: l.words.filter((w) => w.text.trim().length > 0), bbox: l.bbox, lineNo: null, size: sizeOf(l) }))
        .filter((l) => l.words.length > 0);
      if (lines.length) paras.push({ lines, blk: bi });
    }

  const allLines = paras.flatMap((p) => p.lines);
  if (!allLines.length) return { blocks: [], origPageNo: null, meanConf: 0 };
  const textLines = allLines.filter((l) => l.words.length >= 3);
  const medH = median((textLines.length ? textLines : allLines).map(lineH)) || 20;
  const medSize = median((textLines.length ? textLines : allLines).map((l) => l.size)) || medH;

  // Konfidenz gesamt (gewichtet nach Zeichen)
  let confSum = 0;
  let confN = 0;
  for (const l of allLines)
    for (const w of l.words) {
      confSum += w.confidence * w.text.length;
      confN += w.text.length;
    }
  const meanConf = confN ? confSum / confN : 0;

  // Linke/rechte Textkante (typische Zeilenanfänge/-enden)
  const leftEdge = median(textLines.map((l) => l.words[0].bbox.x0));
  const rightEdge = median(textLines.map((l) => l.words[l.words.length - 1].bbox.x1));

  // 2. Gedruckte Zeilennummern sammeln (Kandidaten), danach gegen die Zeilenabfolge prüfen
  type Cand = { line: WLine; value: string; conf: number; removed?: { word: OWord; at: 'start' | 'end' } };
  const cands: Cand[] = [];
  for (const l of allLines) {
    if (l.words.length < 2) continue;
    const first = l.words[0];
    const second = l.words[1];
    const gapL = second.bbox.x0 - first.bbox.x1;
    if (isNumberToken(first.text) && gapL > medH * 1.2 && first.bbox.x1 <= leftEdge + medH * 0.5) {
      l.words = l.words.slice(1);
      cands.push({ line: l, value: first.text, conf: first.confidence, removed: { word: first, at: 'start' } });
      continue;
    }
    const last = l.words[l.words.length - 1];
    const prev = l.words[l.words.length - 2];
    const gapR = last.bbox.x0 - prev.bbox.x1;
    if (isNumberToken(last.text) && gapR > medH * 2 && last.bbox.x0 >= rightEdge - medH * 0.5) {
      l.words = l.words.slice(0, -1);
      cands.push({ line: l, value: last.text, conf: last.confidence, removed: { word: last, at: 'end' } });
    }
  }

  // Absätze, die nur aus einzelnen Randzahlen bestehen (eigene Spalte)
  const isNumberColumn = (p: P) =>
    p.lines.every((l) => l.words.length === 1 && isNumberToken(l.words[0].text) && l.bbox.x1 - l.bbox.x0 < medH * 2.5);
  const numberParas = paras.filter(isNumberColumn);
  const colWords: OWord[] = numberParas.flatMap((p) => p.lines.map((l) => l.words[0]));
  if (numberParas.length) paras = paras.filter((p) => !numberParas.includes(p));

  // Wörter aus dem Randdurchgang
  const sideWords = margins
    .filter((m) => m.side === 'left' || m.side === 'right')
    .flatMap((m) => m.words.filter((w) => isNumberToken(w.text.trim())));

  const textLinesOrdered = paras.flatMap((p) => p.lines);
  const nearestLine = (w: OWord) => {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    let best: WLine | null = null;
    let bestD = Infinity;
    for (const l of textLinesOrdered) {
      // nur Zeilen derselben Spalte (Zahl links oder rechts neben der Zeile)
      const d = Math.abs((l.bbox.y0 + l.bbox.y1) / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best && bestD < medH * 0.7 ? best : null;
  };
  for (const w of [...colWords, ...sideWords]) {
    const l = nearestLine(w);
    if (l && !cands.some((c) => c.line === l)) cands.push({ line: l, value: w.text.trim(), conf: w.confidence });
  }

  // Prüfung: Nummer − Zeilenindex muss bei allen gültigen Nummern gleich sein
  const idxOf = new Map(textLinesOrdered.map((l, i) => [l, i]));
  const offsets = new Map<number, number>();
  for (const c of cands) {
    if (c.conf < 60) continue;
    const off = Number(c.value) - (idxOf.get(c.line) ?? 0);
    offsets.set(off, (offsets.get(off) ?? 0) + 1);
  }
  let bestOff: number | null = null;
  let bestCount = 0;
  for (const [off, n] of offsets)
    if (n > bestCount) {
      bestOff = off;
      bestCount = n;
    }
  const strongSingle = bestCount === 1 && cands.length === 1 && cands[0].conf >= 85 && Number(cands[0].value) % 5 === 0;
  for (const c of cands) {
    const off = Number(c.value) - (idxOf.get(c.line) ?? 0);
    const ok = bestOff !== null && off === bestOff && (bestCount >= 2 || strongSingle || cands.filter((x) => x.conf >= 60).length === 1);
    if (ok && c.conf >= 10) {
      c.line.lineNo = c.value;
    } else if (c.removed) {
      // keine Zeilennummer → Zahl gehört zum Text und wird wieder eingefügt
      if (c.removed.at === 'start') c.line.words.unshift(c.removed.word);
      else c.line.words.push(c.removed.word);
    }
  }
  for (const l of textLinesOrdered) {
    l.bbox = { ...l.bbox, x0: l.words[0].bbox.x0, x1: l.words[l.words.length - 1].bbox.x1 };
  }
  // nicht zuordenbare Zahlen aus einer eigenen Zahlenspalte bleiben als Text erhalten
  for (const p of numberParas)
    for (const nl of p.lines) if (!textLinesOrdered.some((l) => l.lineNo === nl.words[0].text && nearestLine(nl.words[0]) === l)) paras.push({ lines: [nl] });

  // 2b. Randstörungen entfernen: Satzzeichen-/Bruchstücke links bzw. rechts außerhalb der Textspalte
  //     (z. B. gewölbte Nachbarseite, Schatten). Echte Wörter bleiben immer erhalten.
  const isJunk = (w: OWord) => {
    const t = w.text.trim();
    const hasLetters = /[\p{L}]/u.test(t);
    if (!/[\p{L}\p{N}]/u.test(t)) return true;
    return w.confidence < 55 && t.length <= 2 && (!hasLetters || w.confidence < 35);
  };
  const strokes = textLinesOrdered.flatMap((l) => l.words.filter((w) => w.text.length >= 3 && w.stroke).map((w) => w.stroke!));
  const medStroke0 = median(strokes);
  const faint = (w: OWord) => w.stroke !== undefined && medStroke0 > 0 && w.stroke < medStroke0 * 0.75;
  const edgeJunk = (w: OWord, gap: number) => {
    const t = w.text.trim();
    if (gap < medH * 0.25) return false; // hängt am Wort → Teil des Textes
    // Zeichen ohne Buchstaben/Ziffern: nur entfernen, wenn unsicher oder ohne erkennbare Tinte
    // (ein echter Gedankenstrich am Zeilenanfang bleibt erhalten)
    if (!/[\p{L}\p{N}]/u.test(t)) return w.confidence < 75 || w.stroke === 0;
    return t.length <= 2 && w.confidence < 75 && faint(w);
  };
  for (const l of textLinesOrdered) {
    while (l.words.length > 1 && edgeJunk(l.words[0], l.words[1].bbox.x0 - l.words[0].bbox.x1)) l.words.shift();
    while (l.words.length > 1 && edgeJunk(l.words[l.words.length - 1], l.words[l.words.length - 1].bbox.x0 - l.words[l.words.length - 2].bbox.x1))
      l.words.pop();
    l.bbox = { ...l.bbox, x0: l.words[0].bbox.x0, x1: l.words[l.words.length - 1].bbox.x1 };
  }
  // Zeilen, die nur aus Störzeichen bestehen und außerhalb der Spalte liegen, entfallen
  for (const p of paras) p.lines = p.lines.filter((l) => !(l.words.every(isJunk) && (l.bbox.x1 < leftEdge || l.bbox.x0 > rightEdge)));
  paras = paras.filter((p) => p.lines.length);

  // 2c. Auszeichnung je Zeile: Fettdruck (Strichstärke im Verhältnis zur Schriftgröße) und Farbe
  const relStroke = (w: OWord) => w.stroke ?? 0;
  const strokeSamples: number[] = [];
  const chromaSamples: number[] = [];
  for (const p of paras)
    for (const l of p.lines)
      for (const w of l.words)
        if (w.text.length >= 3 && w.stroke) {
          strokeSamples.push(relStroke(w));
          chromaSamples.push(w.chroma ?? 0);
        }
  const medStroke = median(strokeSamples);
  const medChroma = median(chromaSamples);
  for (const p of paras)
    for (const l of p.lines) {
      let boldChars = 0;
      let colorChars = 0;
      let chars = 0;
      for (const w of l.words) {
        const n = w.text.length;
        chars += n;
        if (medStroke > 0 && w.stroke && relStroke(w) >= medStroke * 1.2) boldChars += n;
        if (w.chroma !== undefined && w.chroma >= Math.max(10, medChroma * 2.2, medChroma + 6)) colorChars += n;
      }
      l.bold = chars > 0 && boldChars / chars >= 0.55;
      l.colored = chars > 0 && colorChars / chars >= 0.7;
    }
  const emphasized = (l: WLine) => !!(l.bold || l.colored || l.size >= medSize * 1.2);

  // 3. Absätze neu bilden – innerhalb eines Textblocks (Spalte) nach Satzregeln:
  //    größerer Abstand, kurze letzte Zeile mit Satzende, Einzug, Wechsel der Auszeichnung/Größe.
  const gaps: number[] = [];
  for (const p of paras)
    for (let i = 1; i < p.lines.length; i++) gaps.push(p.lines[i].bbox.y0 - p.lines[i - 1].bbox.y1);
  const medGap = Math.max(1, median(gaps));
  const groups: P[] = [];
  for (const p of paras) {
    const last = groups[groups.length - 1];
    let join = !!last && last.blk !== undefined && last.blk === p.blk;
    if (last && !join) {
      // Tesseract teilt eine Spalte manchmal in mehrere Blöcke: direkt darunter, gleiche Spalte → zusammen
      const a = last.lines[last.lines.length - 1];
      const b = p.lines[0];
      const lx0 = Math.min(...last.lines.map((l) => l.bbox.x0));
      const lx1 = Math.max(...last.lines.map((l) => l.bbox.x1));
      const overlap = Math.min(lx1, b.bbox.x1) - Math.max(lx0, b.bbox.x0);
      const below = b.bbox.y0 > a.bbox.y0 && b.bbox.y0 - a.bbox.y1 < medH * 1.5;
      join = below && overlap > Math.min(lx1 - lx0, b.bbox.x1 - b.bbox.x0) * 0.5;
    }
    if (join && last) last.lines.push(...p.lines);
    else groups.push({ lines: [...p.lines], blk: p.blk });
  }
  const rebuilt: P[] = [];
  for (const g of groups) {
    const body = g.lines.filter((l) => l.words.length >= 3);
    const colLeft = median((body.length ? body : g.lines).map((l) => l.bbox.x0));
    const rights = (body.length ? body : g.lines).map((l) => l.bbox.x1).sort((x, y) => x - y);
    const colRight = rights[Math.floor(rights.length * 0.85)] ?? rights[rights.length - 1];
    const isShort = (l: WLine) => l.bbox.x1 < colRight - medH * 2;
    // Gedichte/Listen: überwiegend kurze Zeilen → nicht an jeder kurzen Zeile trennen
    const mostlyShort = g.lines.filter(isShort).length > g.lines.length * 0.5;
    let cur: WLine[] = [];
    for (const l of g.lines) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const gap = l.bbox.y0 - prev.bbox.y1;
        const bigGap = gap > Math.max(medH * 0.7, medGap * 2.2);
        const sizeJump = Math.abs(l.size - prev.size) > medSize * 0.25;
        const styleChange = emphasized(l) !== emphasized(prev) || !!l.colored !== !!prev.colored;
        const indentStart = l.bbox.x0 > colLeft + medH * 0.8 && l.bbox.x0 < colLeft + medH * 5 && prev.bbox.x0 <= colLeft + medH * 0.5;
        const endsSentence = /[.!?:“”"»«)]$/.test(textOf(prev));
        const shortEnd = !mostlyShort && isShort(prev) && endsSentence;
        if (bigGap || sizeJump || styleChange || indentStart || shortEnd) {
          rebuilt.push({ lines: cur, blk: g.blk });
          cur = [];
        }
      }
      cur.push(l);
    }
    if (cur.length) rebuilt.push({ lines: cur, blk: g.blk });
  }
  paras = rebuilt;

  // 4. Seitenzahl und Kopf-/Fußzeilen
  let origPageNo: string | null = null;
  const topZone = imgH * 0.1;
  const bottomZone = imgH * 0.9;
  const hiddenNotes = new Map<P, string>();
  for (const p of paras) {
    if (p.lines.length !== 1) continue;
    const l = p.lines[0];
    const t = textOf(l);
    const inTop = l.bbox.y1 < topZone;
    const inBottom = l.bbox.y0 > bottomZone;
    if (!inTop && !inBottom) continue;
    const m = t.match(PAGE_NO_RE);
    if (m) {
      origPageNo = origPageNo ?? m[1];
      hiddenNotes.set(p, 'Seitenzahl');
      continue;
    }
    // Kolumnentitel mit Seitenzahl am Rand, z. B. "24   Kapitel 2"
    if (inTop && l.words.length >= 2) {
      const f = l.words[0];
      const la = l.words[l.words.length - 1];
      const numFirst = /^\d{1,4}$/.test(f.text) && l.words[1].bbox.x0 - f.bbox.x1 > medH * 1.5;
      const numLast = /^\d{1,4}$/.test(la.text) && la.bbox.x0 - l.words[l.words.length - 2].bbox.x1 > medH * 1.5;
      if (numFirst || numLast) {
        origPageNo = origPageNo ?? (numFirst ? f.text : la.text);
        hiddenNotes.set(p, 'Kopfzeile');
      }
    }
  }

  // Seitenzahl aus dem Randdurchgang (oben/unten), falls im Haupttext keine gefunden
  if (!origPageNo) {
    for (const m of margins) {
      if (m.side !== 'top' && m.side !== 'bottom') continue;
      const t = m.words
        .filter((w) => w.confidence > 45)
        .map((w) => cleanWord(w.text))
        .join(' ');
      const mm = t.match(PAGE_NO_RE);
      if (mm) {
        origPageNo = mm[1];
        break;
      }
      // einzelne Zahl im Randbereich (z. B. zentrierte Seitenzahl)
      const nums = m.words.filter((w) => /^\d{1,4}$/.test(w.text.trim()) && w.confidence > 60);
      if (nums.length === 1) {
        origPageNo = nums[0].text.trim();
        break;
      }
    }
  }

  // 5. Typ bestimmen und Blöcke erzeugen
  const pageContentBottom = Math.max(...paras.filter((p) => !hiddenNotes.has(p)).map((p) => p.lines[p.lines.length - 1].bbox.y1), 0);
  const blocks: Block[] = [];
  for (const p of paras) {
    const h = median(p.lines.map(lineH));
    const size = median(p.lines.map((l) => l.size));
    const top = p.lines[0].bbox.y0;
    const text0 = textOf(p.lines[0]);
    let type: BlockType = 'p';
    const note = hiddenNotes.get(p);
    if (note) type = 'hidden';
    else if (p.lines.length <= 4 && p.lines.every(emphasized) && text0.length < 160 && !/[,;]$/.test(text0))
      type = size >= medSize * 1.35 || p.lines.every((l) => l.colored) ? 'h1' : 'h2';
    else if (p.lines.length <= 2 && size >= medSize * 1.15 && text0.length < 100 && !/[,;.]$/.test(text0)) type = 'h2';
    else if (
      (size <= medSize * 0.86 || h <= medH * 0.8) &&
      top > imgH * 0.55 &&
      (/^(\d{1,3}|[*†]+)\)?\s/.test(text0) || p.lines[0].words[0].bbox.y1 - p.lines[0].words[0].bbox.y0 < medH * 0.8) &&
      pageContentBottom - top < imgH * 0.4
    ) type = 'footnote';

    let text = '';
    const marks: Mark[] = [];
    const lineNos: (string | null)[] = [];
    const lineBoxes: Box[] = [];
    p.lines.forEach((l, li) => {
      if (li > 0) text += '\n';
      l.words.forEach((w, wi) => {
        if (wi > 0) text += ' ';
        const wt = cleanWord(w.text);
        const start = text.length;
        text += wt;
        if (w.confidence < STORE_MARK_BELOW) marks.push({ start, end: text.length, conf: Math.round(w.confidence) });
      });
      lineNos.push(l.lineNo);
      lineBoxes.push({ x0: l.bbox.x0 / imgW, y0: l.bbox.y0 / imgH, x1: l.bbox.x1 / imgW, y1: l.bbox.y1 / imgH });
    });
    blocks.push({ id: newId(), type, text, marks, lineNos, lineBoxes, ...(note ? { note } : {}) });
  }

  return { blocks, origPageNo, meanConf };
}
