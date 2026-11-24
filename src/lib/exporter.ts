import { buildPdf, type FontBytes } from './pdf';
import { canvasToBlob, renderTransformed } from './image';
import type { Page, Settings } from '../types';

let fontsPromise: Promise<FontBytes> | null = null;
const fetchBytes = async (p: string) => {
  const r = await fetch(new URL(p, document.baseURI).href);
  if (!r.ok) throw new Error(`Schriftdatei fehlt: ${p}`);
  return new Uint8Array(await r.arrayBuffer());
};
function loadFonts(): Promise<FontBytes> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      fetchBytes('fonts/LiberationSans-Regular.ttf'),
      fetchBytes('fonts/LiberationSans-Bold.ttf'),
      fetchBytes('fonts/LiberationSans-Italic.ttf'),
    ])
      .then(([regular, bold, italic]) => ({ regular, bold, italic }))
      .catch((e) => {
        fontsPromise = null;
        throw e;
      });
  }
  return fontsPromise;
}

export async function createPdf(pages: Page[], settings: Settings): Promise<Uint8Array> {
  const fonts = await loadFonts();
  return buildPdf(pages, settings, fonts, async (page) => {
    const c = await renderTransformed(page, 2400);
    const b = await canvasToBlob(c, 'image/jpeg', 0.85);
    return { bytes: new Uint8Array(await b.arrayBuffer()), width: c.width, height: c.height };
  });
}

export const safeFileName = (name: string) => {
  const base = name.trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').slice(0, 120) || 'Dokument';
  return `${base}.pdf`;
};

export function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
