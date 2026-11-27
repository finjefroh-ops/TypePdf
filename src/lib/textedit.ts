import type { Block, Mark } from '../types';
import { newId } from './analyze';

const countNl = (s: string, end: number) => {
  let n = 0;
  for (let i = 0; i < end; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * Übernimmt eine Textänderung des Nutzers. Markierungen, die vom bearbeiteten Bereich
 * berührt werden, gelten als geprüft und entfallen; spätere verschieben sich mit.
 * Originale Zeilennummern bleiben an ihren Zeilen.
 */
export function applyTextEdit(block: Block, next: string): Block {
  const prev = block.text;
  if (prev === next) return block;
  let pre = 0;
  const minLen = Math.min(prev.length, next.length);
  while (pre < minLen && prev[pre] === next[pre]) pre++;
  let suf = 0;
  while (suf < minLen - pre && prev[prev.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
  const oldEnd = prev.length - suf;
  const newEnd = next.length - suf;
  const delta = newEnd - oldEnd;

  const marks: Mark[] = [];
  for (const m of block.marks) {
    if (m.end <= pre) marks.push(m);
    else if (m.start >= oldEnd) marks.push({ ...m, start: m.start + delta, end: m.end + delta });
    // überlappend → als geprüft betrachten
  }

  const startLine = countNl(prev, pre);
  const oldEndLine = countNl(prev, oldEnd);
  const newEndLine = countNl(next, newEnd);
  const oldCount = oldEndLine - startLine + 1;
  const newCount = newEndLine - startLine + 1;
  const region = block.lineNos.slice(startLine, startLine + oldCount);
  const newRegion: (string | null)[] = [];
  for (let i = 0; i < newCount; i++) newRegion.push(i < region.length ? region[i] : null);
  // Wurden Zeilen gelöscht, bleiben deren Nummern erhalten, sofern eine Zeile übrig ist ohne Nummer
  if (region.length > newCount) {
    for (const n of region.slice(newCount)) {
      if (!n) continue;
      const free = newRegion.lastIndexOf(null);
      if (free >= 0) newRegion[free] = n;
    }
  }
  const lineNos = [...block.lineNos.slice(0, startLine), ...newRegion, ...block.lineNos.slice(startLine + oldCount)];
  const total = countNl(next, next.length) + 1;
  while (lineNos.length < total) lineNos.push(null);
  lineNos.length = total;

  return { ...block, text: next, marks, lineNos };
}

/** Teilt einen Block an einer Cursorposition in zwei Blöcke. */
export function splitBlock(block: Block, pos: number): [Block, Block] | null {
  let a = block.text.slice(0, pos);
  let b = block.text.slice(pos);
  const aTrim = a.replace(/[ \n]+$/, '');
  const bLead = b.length - b.replace(/^[ \n]+/, '').length;
  a = aTrim;
  b = b.slice(bLead);
  if (!a.length || !b.length) return null;
  const bStart = pos + bLead;
  const aLines = countNl(a, a.length) + 1;
  const bFirstLine = countNl(block.text, bStart);
  const marksA = block.marks.filter((m) => m.end <= a.length);
  const marksB = block.marks.filter((m) => m.start >= bStart).map((m) => ({ ...m, start: m.start - bStart, end: m.end - bStart }));
  const lnA = block.lineNos.slice(0, aLines);
  const lnB = block.lineNos.slice(bFirstLine);
  if (bFirstLine < aLines && lnB.length) lnB[0] = null; // Zeile wurde mittig geteilt
  const boxA = block.lineBoxes.slice(0, aLines);
  const boxB = block.lineBoxes.slice(bFirstLine);
  return [
    { ...block, text: a, marks: marksA, lineNos: lnA, lineBoxes: boxA },
    { id: newId(), type: block.type === 'hidden' ? 'hidden' : 'p', text: b, marks: marksB, lineNos: lnB, lineBoxes: boxB },
  ];
}

/** Verbindet zwei Blöcke (Zeilenumbruch dazwischen bleibt erhalten). */
export function mergeBlocks(a: Block, b: Block): Block {
  const off = a.text.length + 1;
  return {
    ...a,
    text: `${a.text}\n${b.text}`,
    marks: [...a.marks, ...b.marks.map((m) => ({ ...m, start: m.start + off, end: m.end + off }))],
    lineNos: [...a.lineNos, ...b.lineNos],
    lineBoxes: [...a.lineBoxes, ...b.lineBoxes],
  };
}

/** Index der Zeile, in der eine Zeichenposition liegt. */
export const lineIndexAt = (text: string, pos: number) => countNl(text, pos);

/**
 * Löst den Bereich [start, end) als eigenen Abschnitt heraus.
 * Ergebnis: [davor?, Auswahl, danach?] und der Index des ausgewählten Teils.
 * Davor und danach behalten die ursprüngliche Art (z. B. Absatz).
 */
export function extractRange(block: Block, start: number, end: number): { parts: Block[]; index: number } {
  const t = block.text;
  // Leerraum an den Rändern der Auswahl ignorieren
  while (start < end && /\s/.test(t[start])) start++;
  while (end > start && /\s/.test(t[end - 1])) end--;
  if (end <= start) return { parts: [block], index: 0 };
  let rest: Block = block;
  let after: Block | null = null;
  if (t.slice(end).trim()) {
    const sp = splitBlock(block, end);
    if (sp) {
      rest = sp[0];
      after = { ...sp[1], type: block.type };
    }
  }
  let before: Block | null = null;
  let mid: Block = rest;
  if (t.slice(0, start).trim()) {
    const sp = splitBlock(rest, start);
    if (sp) {
      before = sp[0];
      mid = sp[1];
    }
  }
  const parts = [before, mid, after].filter(Boolean) as Block[];
  return { parts, index: before ? 1 : 0 };
}

/** Zeilenumbrüche im Bereich durch Leerzeichen ersetzen (Trennstriche am Zeilenende zusammenführen). */
export function joinLinesInRange(block: Block, start: number, end: number): Block {
  const seg = block.text.slice(start, end).replace(/([\p{L}])-\n(\p{Ll})/gu, '$1$2').replace(/\s*\n\s*/g, ' ');
  return applyTextEdit(block, block.text.slice(0, start) + seg + block.text.slice(end));
}
