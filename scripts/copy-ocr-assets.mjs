// Kopiert Tesseract-Worker, WASM-Core und das deutsche Sprachmodell nach public/ocr,
// damit die OCR vollständig lokal (ohne CDN) läuft.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
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
