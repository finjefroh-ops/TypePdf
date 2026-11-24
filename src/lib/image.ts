import type { Page } from '../types';

/** Maximale Kantenlänge, mit der intern gearbeitet wird (schützt den Speicher bei sehr großen Fotos). */
export const MAX_SIDE = 4200;

const bitmapCache = new Map<Blob, Promise<ImageBitmap>>();

/** Lädt ein Bild unter Berücksichtigung der EXIF-Ausrichtung. */
export function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  let p = bitmapCache.get(blob);
  if (!p) {
    p = createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(async () => {
      // Fallback für Browser ohne Optionen
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return await createImageBitmap(img);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    bitmapCache.set(blob, p);
    if (bitmapCache.size > 12) {
      const first = bitmapCache.keys().next().value;
      if (first) bitmapCache.delete(first);
    }
  }
  return p;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Größe nach Drehung + Begradigung (vor dem Zuschnitt). */
export function rotatedSize(w: number, h: number, rotation: number, skew: number) {
  const a = ((rotation + skew) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  return { w: w * cos + h * sin, h: w * sin + h * cos };
}

type TransformInput = Pick<Page, 'blob' | 'rotation' | 'skew' | 'crop'>;

/**
 * Rendert das Bild mit Drehung, Begradigung und Zuschnitt.
 * maxSide begrenzt die längste Kante des Ergebnisses.
 */
export async function renderTransformed(
  page: TransformInput,
  maxSide = MAX_SIDE,
  opts: { ignoreCrop?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const bmp = await loadBitmap(page.blob);
  const rs = rotatedSize(bmp.width, bmp.height, page.rotation, page.skew);
  const crop = opts.ignoreCrop || !page.crop ? { x: 0, y: 0, w: 1, h: 1 } : page.crop;
  const outW0 = rs.w * crop.w;
  const outH0 = rs.h * crop.h;
  const scale = Math.min(1, maxSide / Math.max(outW0, outH0));
  const c = makeCanvas(outW0 * scale, outH0 * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.translate(-crop.x * rs.w, -crop.y * rs.h);
  ctx.translate(rs.w / 2, rs.h / 2);
  ctx.rotate(((page.rotation + page.skew) * Math.PI) / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden'))), type, q));
}

/** Graustufen-Pixel (0..255) aus einem Canvas. */
function toGray(c: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const g = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

/**
 * Vorverarbeitung für die OCR: Graustufen, Ausgleich ungleichmäßiger Beleuchtung
 * (Division durch geschätzten Hintergrund) und Kontrastspreizung.
 * Der Text selbst wird dabei nicht verändert, nur die Lesbarkeit verbessert.
 */
export function preprocessForOcr(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const gray = toGray(src);

  // Hintergrund auf verkleinertem Raster schätzen (lokales Maximum → Weichzeichnen)
  const cell = Math.max(8, Math.round(Math.max(w, h) / 160));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // 90%-Perzentil statt Maximum (robust gegen Rauschen)
      const hist = new Uint32Array(32);
      let n = 0;
      const y1 = Math.min(h, (gy + 1) * cell);
      const x1 = Math.min(w, (gx + 1) * cell);
      for (let y = gy * cell; y < y1; y += 2) {
        for (let x = gx * cell; x < x1; x += 2) {
          hist[gray[y * w + x] >> 3]++;
          n++;
        }
      }
      let acc = 0;
      let v = 31;
      for (; v > 0; v--) {
        acc += hist[v];
        if (acc >= n * 0.1) break;
      }
      grid[gy * gw + gx] = v * 8 + 4;
    }
  }
  // Max-Filter 3x3 dann Box-Blur, damit Textflächen den Hintergrund nicht abdunkeln
  const dil = new Float32Array(grid.length);
  const R = 2;
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let m = 0;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const yy = Math.min(gh - 1, Math.max(0, gy + dy));
          const xx = Math.min(gw - 1, Math.max(0, gx + dx));
          m = Math.max(m, grid[yy * gw + xx]);
        }
      dil[gy * gw + gx] = m;
    }
  const bg = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let k = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const yy = gy + dy;
          const xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          s += dil[yy * gw + xx];
          k++;
        }
      bg[gy * gw + gx] = Math.max(40, s / k);
    }

  const out = makeCanvas(w, h);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const od = img.data;
  const norm = new Uint8ClampedArray(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, y / cell - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / cell - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const i00 = y0 * gw + x0;
      const b =
        bg[i00] * (1 - tx) * (1 - ty) +
        bg[i00 + (x0 + 1 < gw ? 1 : 0)] * tx * (1 - ty) +
        bg[i00 + (y0 + 1 < gh ? gw : 0)] * (1 - tx) * ty +
        bg[i00 + (y0 + 1 < gh ? gw : 0) + (x0 + 1 < gw ? 1 : 0)] * tx * ty;
      const v = Math.min(255, (gray[y * w + x] / b) * 255);
      norm[y * w + x] = v;
      hist[v | 0]++;
    }
  }
  // Kontrastspreizung: dunkelstes 0,5 % → 0
  let lo = 0;
  let acc = 0;
  const total = w * h;
  for (; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > total * 0.005) break;
  }
  const hi = 250;
  const range = Math.max(1, hi - lo);
  for (let j = 0, i = 0; j < norm.length; j++, i += 4) {
    const v = Math.max(0, Math.min(255, ((norm[j] - lo) / range) * 255));
    od[i] = od[i + 1] = od[i + 2] = v;
    od[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Bild für die OCR vorbereiten: Größe angleichen. Liefert die Farbfassung (für die
 * Erkennung farbiger Überschriften) und die bereinigte Graustufenfassung (für die OCR).
 */
export async function prepareOcrImage(page: TransformInput): Promise<HTMLCanvasElement> {
  let c = await renderTransformed(page, 3600);
  const longSide = Math.max(c.width, c.height);
  // Kleine Bilder hochskalieren: Tesseract arbeitet am besten bei ~300 dpi
  if (longSide < 1800) {
    const f = Math.min(2.5, 2200 / longSide);
    const up = makeCanvas(c.width * f, c.height * f);
    const ctx = up.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, up.width, up.height);
    c = up;
  }
  return c;
}

/**
 * Schätzt den Schräglagewinkel (Grad) über Projektionsprofile.
 * Liefert die Korrektur, die zu page.skew addiert werden muss.
 */
export async function estimateSkew(page: TransformInput): Promise<number> {
  const c = await renderTransformed({ ...page, crop: page.crop }, 1100);
  const w = c.width;
  const h = c.height;
  const g = toGray(c);
  // Schwelle: Mittelwert - Abstand
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i];
  const mean = sum / g.length;
  const thr = mean * 0.72;
  const xs: number[] = [];
  const ys: number[] = [];
  const mx = w * 0.04;
  const my = h * 0.04;
  for (let y = my; y < h - my; y += 1)
    for (let x = mx; x < w - mx; x += 2) {
      if (g[(y | 0) * w + (x | 0)] < thr) {
        xs.push(x - w / 2);
        ys.push(y - h / 2);
      }
    }
  if (xs.length < 200) return 0;
  // Unterabtastung
  const step = Math.max(1, Math.floor(xs.length / 40000));
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const s = Math.sin(a);
    const co = Math.cos(a);
    const bins = new Float32Array(h * 2);
    for (let i = 0; i < xs.length; i += step) {
      const yy = Math.round(xs[i] * s + ys[i] * co + h);
      if (yy >= 0 && yy < bins.length) bins[yy]++;
    }
    let e = 0;
    for (let i = 1; i < bins.length; i++) {
      const d = bins[i] - bins[i - 1];
      e += d * d;
    }
    return e;
  };
  let best = 0;
  let bestScore = -1;
  for (let d = -10; d <= 10; d += 0.5) {
    const sc = score(d);
    if (sc > bestScore) {
      bestScore = sc;
      best = d;
    }
  }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5; d += 0.05) {
    const sc = score(d);
    if (sc > bestScore) {
      bestScore = sc;
      best = d;
    }
  }
  // Eine um t im Uhrzeigersinn geneigte Zeile liefert best = -t → genau diese Drehung begradigt.
  return Math.round(best * 100) / 100;
}

/** Natürliche Sortierung von Dateinamen (IMG_2 vor IMG_10). */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const isAcceptedFile = (f: File) =>
  ACCEPTED_TYPES.includes(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
