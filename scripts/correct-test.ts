// Korrektur-Test: typische OCR-Fehler werden korrigiert, korrekte (auch seltene) Wörter nie.
// Aufruf: npx tsx scripts/correct-test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLexicon, analyzeWord, suggestForBlocks, buildDocVocab } from '../src/lib/correct';
const lex = buildLexicon(readFileSync(join(process.cwd(), 'public/lexicon/de.txt'), 'utf8').split('\n'));
const ctx = 'Der Handlungsort ist Frankreich. Das Ziel des Spiels ist es, die Krankheit zu überleben. Die Pest dient als Handlungselement in Computerspielen.';
const vocab = buildDocVocab([[{ id: 'x', type: 'p', text: ctx, marks: [], lineNos: [], lineBoxes: [] }]]);
const cases: [string, string | null][] = [
  ['Krankleit', 'Krankheit'], ['Pestepidernie', 'Pestepidemie'], ['Handlungselernent', 'Handlungselement'], ['verbreiteu', null /* zwei gleich gute Kandidaten → nur Vorschlag */],
  ['Geschiclite', 'Geschichte'], ['iiberleben', 'überleben'], ['Spieis', 'Spiels'], ['Atrnosphäre', 'Atmosphäre'],
  // korrekt – darf nicht geändert werden
  ['verseuchten', null], ['Rattenschwärmen', null], ['übernatürlichen', null], ['Plague', null], ['Survival-', null], ['Spiel.', null], ['Requiem“', null], ['schwärmen', null], ['versickert', null], ['versickerte', null], ['Büchern', null],
];
let ok = 0;
for (const [w, want] of cases) {
  const block = { id: 'b', type: 'p' as const, text: `xx ${w} yy`, marks: [{ start: 3, end: 3 + w.length, conf: 50 }], lineNos: [null], lineBoxes: [] };
  const out = suggestForBlocks([block], lex, vocab, 80, true)[0];
  const got = out.text.slice(3, out.text.length - 3);
  const changed = got !== w;
  const pass = want ? got === want : !changed;
  if (pass) ok++;
  const a = analyzeWord(w, lex, vocab);
  console.log(`${pass ? '✓' : '✗'} ${w.padEnd(18)} → ${got.padEnd(18)} valid=${a?.valid} sugg=${a?.suggestions.map((s) => s.word + ':' + s.score.toFixed(1)).join(', ')}`);
}
console.log(`${ok}/${cases.length}`);
// „verbreiteu“: richtiger Vorschlag steht vorn
const vb = analyzeWord('verbreiteu', lex, vocab);
const vbOk = vb?.suggestions[0]?.word === 'verbreiten';
console.log(`${vbOk ? '✓' : '✗'} Vorschlag für „verbreiteu“: ${vb?.suggestions[0]?.word}`);
const t0 = Date.now();
for (let i = 0; i < 50; i++) analyzeWord('Handlungselernent', lex, vocab);
console.log('ms/Wort', (Date.now() - t0) / 50);
process.exit(ok === cases.length && vbOk ? 0 : 1);
