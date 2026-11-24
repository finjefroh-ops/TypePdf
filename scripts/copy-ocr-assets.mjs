// Kopiert Tesseract-Worker, WASM-Core und das deutsche Sprachmodell nach public/ocr,
// damit die OCR vollständig lokal (ohne CDN) läuft.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/deu/4.0.0/deu.traineddata.gz', 'lang/deu.traineddata.gz'],
];
for (const [src, dst] of files) {
  const from = join(nm, src);
  if (!existsSync(from)) {
    console.error(`[copy-ocr-assets] fehlt: ${src}`);
    process.exit(1);
  }
  cpSync(from, join(out, dst));
}
console.log('[copy-ocr-assets] OCR-Dateien nach public/ocr kopiert');

// Deutsche Wortliste (nach Häufigkeit sortiert) für Korrekturvorschläge – MIT-Lizenz (@zxcvbn-ts/language-de)
const lexDir = join(root, 'public', 'lexicon');
mkdirSync(lexDir, { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(nm, '@zxcvbn-ts/language-de/src', f), 'utf8'));
const wiki = read('wikipedia.json');
const common = read('commonWords.json');
const rank = new Map();
const add = (list, factor) =>
  list.forEach((w, i) => {
    const t = String(w).toLowerCase();
    if (!/^[a-zäöüß]+$/.test(t)) return;
    const r = i * factor;
    if (!rank.has(t) || rank.get(t) > r) rank.set(t, r);
  });
add(wiki, 1);
add(common, 1.6);
for (const junk of ['doc', 'id', 'title', 'url', 'curid', 'https', 'http', 'www', 'html', 'php']) rank.delete(junk);
const words = [...rank.entries()].sort((a, b) => a[1] - b[1]).map(([w]) => w);
writeFileSync(join(lexDir, 'de.txt'), words.join('\n'));
console.log(`[copy-ocr-assets] Wortliste: ${words.length} Wörter`);
