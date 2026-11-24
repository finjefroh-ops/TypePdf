/**
 * Korrekturvorschläge für unsichere OCR-Wörter – lokal, ohne Server.
 *
 * Grundlage:
 *  - deutsche Wortliste nach Häufigkeit (public/lexicon/de.txt)
 *  - Vokabular des eigenen Dokuments (sicher erkannte Wörter auf allen Seiten)
 *  - typische OCR-Verwechslungen (rn↔m, l↔I↔1, ii↔ü, h↔b, c↔e …), die billiger zählen
 *  - Wortpaare aus dem Dokument als Zusammenhang
 *
 * Automatisch ersetzt wird nur, wenn das erkannte Wort sicher kein gültiges Wort ist und
 * genau ein naheliegender Kandidat deutlich vorn liegt. Jede automatische Änderung bleibt
 * markiert und kann rückgängig gemacht werden.
 */
import type { Block, Mark } from '../types';

export interface Lexicon {
  rank: Map<string, number>;
  byLen: Map<number, string[]>;
}

let lexPromise: Promise<Lexicon> | null = null;

export function buildLexicon(words: string[]): Lexicon {
  const rank = new Map<string, number>();
  const byLen = new Map<number, string[]>();
  words.forEach((w, i) => {
    if (!w || rank.has(w)) return;
    rank.set(w, i);
    const l = byLen.get(w.length) ?? [];
    l.push(w);
    byLen.set(w.length, l);
  });
  return { rank, byLen };
}

export function loadLexicon(): Promise<Lexicon> {
  if (!lexPromise) {
    lexPromise = fetch(new URL('lexicon/de.txt', document.baseURI).href)
      .then((r) => {
        if (!r.ok) throw new Error('Wortliste fehlt');
        return r.text();
      })
      .then((t) => buildLexicon(t.split('\n')))
      .catch((e) => {
        lexPromise = null;
        throw e;
      });
  }
  return lexPromise;
}

/** Vokabular des Dokuments: sicher erkannte Wörter und Wortpaare. */
export interface DocVocab {
  words: Map<string, number>;
  pairs: Map<string, number>;
}

const WORD_RE = /[\p{L}]+(?:-[\p{L}]+)*/gu;
const lower = (s: string) => s.toLocaleLowerCase('de-DE');

export function buildDocVocab(blocks: Block[][], minConfFree = true): DocVocab {
  const words = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const page of blocks)
    for (const b of page) {
      if (b.type === 'hidden') continue;
      // Wörter, die von einer Unsicherheits-Markierung berührt werden, zählen nicht
      const unsure = (s: number, e: number) => minConfFree && b.marks.some((m) => m.start < e && m.end > s);
      let prev: string | null = null;
      for (const m of b.text.matchAll(WORD_RE)) {
        const s = m.index ?? 0;
        const w = lower(m[0]);
        if (unsure(s, s + m[0].length)) {
          prev = null;
          continue;
        }
        words.set(w, (words.get(w) ?? 0) + 1);
        if (prev) pairs.set(`${prev} ${w}`, (pairs.get(`${prev} ${w}`) ?? 0) + 1);
        prev = w;
      }
    }
  return { words, pairs };
}

/** Typische OCR-Verwechslungen: [erkannt, richtig] */
const CONFUSIONS: [string, string][] = [
  ['rn', 'm'], ['m', 'rn'], ['ii', 'ü'], ['ü', 'ii'], ['li', 'h'], ['lh', 'h'], ['cl', 'd'], ['vv', 'w'],
  ['l', 'i'], ['i', 'l'], ['I', 'l'], ['l', 'I'], ['1', 'l'], ['1', 'i'], ['0', 'o'], ['5', 's'], ['8', 'B'],
  ['h', 'b'], ['b', 'h'], ['c', 'e'], ['e', 'c'], ['n', 'u'], ['u', 'n'], ['u', 'ü'], ['a', 'ä'], ['o', 'ö'],
  ['ä', 'a'], ['ö', 'o'], ['ü', 'u'], ['B', 'ß'], ['ß', 'B'], ['f', 't'], ['t', 'f'], ['j', 'i'], ['r', 'n'],
  ['k', 'h'], ['h', 'k'], ['l', 'h'], ['h', 'l'], ['l', 't'], ['t', 'l'], ['ı', 'i'], ['ri', 'n'], ['ni', 'm'], ['in', 'm'], ['fi', 'h'], ['ff', 'ﬀ'], ['tt', 'n'],
];
const CHEAP = new Set(CONFUSIONS.filter(([a, b]) => a.length === 1 && b.length === 1).map(([a, b]) => lower(a) + lower(b)));

/** Gewichtete Damerau-Levenshtein-Distanz mit Abbruch über max. */
function distance(a: string, b: string, max: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max + 0.5) return Infinity;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const ca = a[i - 1];
      const cb = b[j - 1];
      const sub = ca === cb ? 0 : CHEAP.has(ca + cb) ? 0.5 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
      if (i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/** Varianten durch mehrbuchstabige Verwechslungen (rn→m usw.) – je Wort höchstens zwei Ersetzungen. */
function confusionVariants(w: string): string[] {
  const out = new Set<string>();
  const step = (s: string) => {
    const res: string[] = [];
    for (const [from, to] of CONFUSIONS) {
      if (from.length === 1 && to.length === 1) continue;
      let idx = s.indexOf(from);
      while (idx >= 0) {
        res.push(s.slice(0, idx) + to + s.slice(idx + from.length));
        idx = s.indexOf(from, idx + 1);
      }
    }
    return res;
  };
  for (const a of step(w)) {
    out.add(a);
    for (const b of step(a)) out.add(b);
  }
  return [...out];
}

export interface Analysis {
  core: string;
  valid: boolean;
  /** gültig und nicht selten (oder im Dokument belegt) */
  strong: boolean;
  rank: number;
  suggestions: { word: string; score: number; cost: number }[];
}

const isKnown = (w: string, lex: Lexicon, vocab?: DocVocab) => lex.rank.has(w) || (vocab?.words.get(w) ?? 0) > 0;

/** Gebeugte Form eines bekannten Wortes? (versickert ← versickern, Büchern ← Bücher …) */
const SUFFIXES = ['tet', 'ten', 'te', 'et', 't', 'en', 'em', 'er', 'es', 'e', 'n', 's', 'st'];
const STEM_ENDINGS = ['', 'en', 'n', 'e', 'er', 't'];
function isInflected(w: string, lex: Lexicon, vocab?: DocVocab): boolean {
  if (w.length < 5) return false;
  for (const suf of SUFFIXES) {
    if (!w.endsWith(suf)) continue;
    const stem = w.slice(0, -suf.length);
    if (stem.length < 3) continue;
    for (const e of STEM_ENDINGS) if (isKnown(stem + e, lex, vocab)) return true;
  }
  // ge-…-t Partizip (gemacht ← machen)
  if (w.startsWith('ge') && w.endsWith('t')) {
    const st = w.slice(2, -1);
    if (st.length >= 3 && (isKnown(st + 'en', lex, vocab) || isKnown(st + 'n', lex, vocab))) return true;
  }
  return false;
}

/** Zusammengesetztes Wort aus zwei bekannten Teilen (mit Fugen-s/-n/-en/-es)? */
const commonEnough = (w: string, lex: Lexicon, vocab?: DocVocab) => (lex.rank.get(w) ?? Infinity) < 40000 || (vocab?.words.get(w) ?? 0) > 0;

function isCompound(w: string, lex: Lexicon, vocab?: DocVocab): boolean {
  if (w.length < 8) return false;
  for (let i = 4; i <= w.length - 4; i++) {
    const head = w.slice(0, i);
    const tail = w.slice(i);
    if (!commonEnough(tail, lex, vocab)) continue;
    for (const fuge of ['', 's', 'n', 'en', 'es', 'e', 'er']) {
      if (fuge && !head.endsWith(fuge)) continue;
      const h = fuge ? head.slice(0, -fuge.length) : head;
      if (h.length >= 4 && commonEnough(h, lex, vocab)) return true;
    }
  }
  return false;
}

/** Buchstabenfolgen, die im Deutschen praktisch nie vorkommen – typische OCR-Artefakte. */
const IMPOSSIBLE = /ii|[a-zäöüß][A-ZÄÖÜ]|[äöü]{2}|^[^aeiouäöüy]{5,}$/;

/** Unterscheiden sich zwei Wörter nur in einer Flexionsendung? Dann nie automatisch ersetzen. */
function inflectionOnly(a: string, b: string): boolean {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  const ra = a.slice(p);
  const rb = b.slice(p);
  return p >= 3 && /^[ensrmt]{0,3}$/.test(ra) && /^[ensrmt]{0,3}$/.test(rb);
}

export function analyzeWord(token: string, lex: Lexicon, vocab?: DocVocab, prevWord?: string, nextWord?: string): Analysis | null {
  // Satzzeichen am Rand bleiben unverändert
  const m = token.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  if (!m) return null;
  const core = m[2];
  if (core.length < 2 || /\d/.test(core) && /^[\d.,:/-]+$/.test(core)) return null;
  const lw = lower(core);
  const valid = !IMPOSSIBLE.test(core) && (isKnown(lw, lex, vocab) || isCompound(lw, lex, vocab) || isInflected(lw, lex, vocab));
  const rank = lex.rank.get(lw) ?? Infinity;
  const strong = valid && (rank < 30000 || (vocab?.words.get(lw) ?? 0) > 0 || (!lex.rank.has(lw) && isCompound(lw, lex, vocab)));
  const cands = new Map<string, number>(); // Kandidat → Kosten

  // 1) mehrbuchstabige Verwechslungen
  for (const v of confusionVariants(lw)) if (v !== lw && isKnown(v, lex, vocab)) cands.set(v, Math.min(cands.get(v) ?? 9, 0.6));
  // 2) gewichtete Editierdistanz gegen Wortliste (Länge ± 2) und Dokumentvokabular
  const maxD = lw.length <= 4 ? 1 : 2;
  const scan = (w: string) => {
    if (w === lw) return;
    const d = distance(lw, w, maxD);
    if (d <= maxD && d < (cands.get(w) ?? 9)) cands.set(w, d);
  };
  for (let len = lw.length - 2; len <= lw.length + 2; len++) for (const w of lex.byLen.get(len) ?? []) scan(w);
  if (vocab) for (const w of vocab.words.keys()) scan(w);

  const ranked = [...cands.entries()]
    .map(([w, cost]) => {
      const r = lex.rank.get(w);
      const freq = r === undefined ? -6 : -Math.log10(r + 50); // häufige Wörter bevorzugen
      const docCount = vocab?.words.get(w) ?? 0;
      const ctx =
        (prevWord && vocab?.pairs.get(`${lower(prevWord)} ${w}`) ? 1.5 : 0) +
        (nextWord && vocab?.pairs.get(`${w} ${lower(nextWord)}`) ? 1.5 : 0);
      const score = -cost * 2.2 + freq + Math.min(3, docCount) * 0.9 + ctx;
      return { word: w, score, cost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => ({ ...c, word: m[1] + matchCase(c.word, core) + m[3] }));
  return { core, valid, strong, rank, suggestions: ranked };
}

function matchCase(cand: string, orig: string) {
  if (orig.length > 1 && orig === orig.toLocaleUpperCase('de-DE')) return cand.toLocaleUpperCase('de-DE');
  if (orig[0] && orig[0] === orig[0].toLocaleUpperCase('de-DE') && orig[0] !== orig[0].toLocaleLowerCase('de-DE'))
    return cand[0].toLocaleUpperCase('de-DE') + cand.slice(1);
  return cand;
}

/**
 * Ergänzt unsichere Markierungen um Vorschläge und ersetzt – falls gewünscht – eindeutige Fälle.
 * Gibt neue Blöcke zurück (Originale bleiben unverändert).
 */
export function suggestForBlocks(blocks: Block[], lex: Lexicon, vocab: DocVocab, threshold: number, autocorrect: boolean): Block[] {
  return blocks.map((b) => {
    if (b.type === 'hidden' || !b.marks.length) return b;
    let text = b.text;
    const marks: Mark[] = [];
    let shift = 0;
    const sorted = [...b.marks].sort((x, y) => x.start - y.start);
    for (const mk of sorted) {
      const start = mk.start + shift;
      const end = mk.end + shift;
      const token = text.slice(start, end);
      if (mk.orig !== undefined) {
        marks.push({ ...mk, start, end });
        continue;
      }
      // Silbentrennung am Zeilenende: „Dar-“ + „stellung“ gemeinsam prüfen
      const atLineEnd = text[end] === '\n' || end === text.length;
      if (/-$/.test(token) && atLineEnd) {
        const next = text.slice(end + 1).match(/^[\p{L}]+/u)?.[0] ?? '';
        const joined = lower(token.replace(/[^\p{L}]/gu, '') + next);
        if (lex.rank.has(joined) || vocab.words.has(joined) || isCompound(joined, lex, vocab)) {
          marks.push({ ...mk, start, end });
          continue;
        }
      }
      // Komma/Semikolon am Absatzende ist fast immer ein falsch gelesener Punkt
      if (/[,;]$/.test(token) && text.slice(end).trim() === '' && mk.conf < 93) {
        const fixedTok = token.slice(0, -1) + '.';
        if (autocorrect) {
          text = text.slice(0, start) + fixedTok + text.slice(end);
          marks.push({ ...mk, start, end, orig: token, sugg: [token] });
        } else marks.push({ ...mk, start, end, sugg: [fixedTok] });
        continue;
      }
      const before = text.slice(0, start).match(/([\p{L}]+)[^\p{L}]*$/u)?.[1];
      const after = text.slice(end).match(/^[^\p{L}]*([\p{L}]+)/u)?.[1];
      const a = analyzeWord(token, lex, vocab, before, after);
      if (!a) {
        marks.push({ ...mk, start, end });
        continue;
      }
      const sugg = a.suggestions.map((s) => s.word).filter((w) => w !== token);
      const best = a.suggestions[0];
      const second = a.suggestions[1];
      const coreLow = lower(a.core);
      const bestCore = best ? lower(best.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')) : '';
      const sure =
        autocorrect &&
        // nur wenn die OCR selbst unsicher war – sicher erkannte unbekannte Wörter sind meist seltene, richtige Wörter
        mk.conf < threshold &&
        // nur Wörter, die es nicht gibt – gültige (auch seltene) Wörter bekommen höchstens einen Vorschlag
        !a.valid &&
        !!best &&
        a.core.length >= 4 &&
        best.cost <= 0.6 && // nur typische OCR-Verwechslungen automatisch

        (!second || best.score - second.score >= 0.8) &&
        !inflectionOnly(coreLow, bestCore);
      if (sure && best) {
        text = text.slice(0, start) + best.word + text.slice(end);
        const d = best.word.length - token.length;
        marks.push({ ...mk, start, end: end + d, orig: token, sugg: [token, ...sugg.filter((w) => w !== best.word)].slice(0, 3) });
        shift += d;
      } else {
        // gültige Wörter bekommen nur bei sehr unsicherer Erkennung Vorschläge
        const show = sugg.length && (!a.strong || mk.conf < Math.min(70, threshold));
        // nicht im Wörterbuch → zur Prüfung anzeigen, auch wenn die OCR recht sicher war
        const unknown = !a.valid && /\p{L}{3,}/u.test(a.core);
        marks.push({ ...mk, start, end, ...(show ? { sugg } : {}), ...(unknown ? { unknown: true } : {}) });
      }
    }
    return { ...b, text, marks };
  });
}
