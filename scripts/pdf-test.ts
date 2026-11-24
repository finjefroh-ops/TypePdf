// Satz-Test: langer Text über viele Seiten – es darf kein Wort verloren gehen.
// Aufruf: npx tsx scripts/pdf-test.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildPdf } from '../src/lib/pdf';
import { defaultSettings, type Page, type Settings } from '../src/types';

const OUT = join(process.cwd(), 'test-output');
mkdirSync(OUT, { recursive: true });
const font = (n: string) => readFileSync(join(process.cwd(), 'public/fonts', n));
const fonts = { regular: font('LiberationSans-Regular.ttf'), bold: font('LiberationSans-Bold.ttf'), italic: font('LiberationSans-Italic.ttf') };

const words = 'Über Bäume, Flüsse und Straßen zogen die Wolken; „schön“ sagte Jörg, während Ärzte über Öl und Maß sprachen – außergewöhnlich'.split(' ');
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const line = () => Array.from({ length: 8 + Math.floor(rnd() * 5) }, () => words[Math.floor(rnd() * words.length)]).join(' ');

const pages: Page[] = Array.from({ length: 12 }, (_, pi) => ({
  id: `p${pi}`, name: `${pi}.jpg`, blob: null as unknown as Blob, width: 1000, height: 1400, rotation: 0, skew: 0, crop: null,
  status: 'done', progress: 1, joinWithPrevious: pi % 3 !== 0, continueParagraph: pi % 3 === 1,
  doc: {
    origPageNo: String(100 + pi), meanConf: 90, transformKey: '', edited: false, createdAt: 0,
    blocks: [
      ...(pi % 3 === 0 ? [{ id: `h${pi}`, type: 'h1' as const, text: `Kapitel ${pi / 3 + 1}: Überschrift`, marks: [], lineNos: [null], lineBoxes: [] }] : []),
      ...Array.from({ length: 6 }, (_, bi) => {
        const lines = Array.from({ length: 5 + Math.floor(rnd() * 12) }, line);
        // überlange Zeile und Silbentrennung testen
        if (bi === 2) lines.push('Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenhersteller'.repeat(2), 'Silben-');
        if (bi === 2) lines.push('trennung am Zeilenende.');
        return { id: `b${pi}-${bi}`, type: (bi === 5 ? 'footnote' : 'p') as 'p' | 'footnote', text: lines.join('\n'), marks: [], lineNos: lines.map((_, i) => ((i + 1) % 5 === 0 ? String(i + 1) : null)), lineBoxes: [] };
      }),
      { id: `x${pi}`, type: 'hidden' as const, text: String(100 + pi), marks: [], lineNos: [null], lineBoxes: [], note: 'Seitenzahl' },
    ],
  },
}));

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fail++; };
const count = (s: string, w: string) => s.split(w).length - 1;

for (const [name, patch] of [
  ['original', { lineBreaks: 'original', lineNumbers: 'document', pageNumbers: 'right' }],
  ['fliesstext', { lineBreaks: 'flow', lineNumbers: 'page', pageNumbers: 'center', fontSize: 10.5 }],
  ['orig-nummern', { lineBreaks: 'original', lineNumbers: 'original', pageNumbers: 'center', pageNumberSource: 'original', pageBreakPerSource: false }],
] as [string, Partial<Settings>][]) {
  const settings = { ...defaultSettings, ...patch, fileName: name };
  const bytes = await buildPdf(pages, settings, fonts);
  const f = join(OUT, `lang-${name}.pdf`);
  writeFileSync(f, bytes);
  const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString();
  const n = Number(execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/)![1]);
  const src = pages.flatMap((p) => p.doc!.blocks.filter((b) => b.type !== 'hidden').map((b) => b.text)).join(' ');
  const flow = settings.lineBreaks === 'flow';
  for (const w of ['Jörg', 'Straßen', 'Ärzte', '„schön“', 'außergewöhnlich']) {
    check(count(txt, w) === count(src, w), `${name}: „${w}“ ${count(src, w)}× im Quelltext, ${count(txt, w)}× im PDF`);
  }
  check(flow ? txt.includes('Silbentrennung') : txt.includes('Silben-'), `${name}: Silbentrennung ${flow ? 'zusammengeführt' : 'wie Vorlage'}`);
  check(!txt.includes('Seitenzahl') && count(txt, '100') <= (settings.pageNumberSource === 'original' ? n : 0) + 1, `${name}: ausgeblendete Blöcke nicht im Text`);
  console.log(`   ${n} Seiten`);
  check(n > 12, `${name}: automatischer Seitenumbruch (${n} Seiten)`);
}
console.log(fail ? `${fail} Prüfung(en) fehlgeschlagen` : 'Alle Satz-Prüfungen bestanden');
process.exit(fail ? 1 : 0);
