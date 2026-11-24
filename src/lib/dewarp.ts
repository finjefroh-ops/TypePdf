/**
 * Entzerrung gewölbter/schräger Buchseiten anhand der Textzeilen.
 *
 * 1. Bild binarisieren, Zeichen finden, Zeichen waagerecht zu Zeilenstücken „verschmieren“.
 * 2. Durch jede Textzeile eine glatte Kurve (Polynom 2. Grades) legen.
 * 3. Das Bild spaltenweise so umrechnen, dass jede Kurve zu einer waagerechten Linie wird;
 *    zwischen den Zeilen wird linear interpoliert.
 *
 * Der Inhalt wird nicht verändert, nur geometrisch begradigt. Gelingt die Analyse nicht
 * zuverlässig (zu wenige Zeilen, widersprüchliche Kurven), bleibt das Bild unverändert.
 */
import { makeCanvas } from './image';

export interface DewarpResult {
  /** Wendet die Entzerrung auf ein Bild gleicher Größe an (z. B. Farb- und Graustufenfassung). */
  apply: (canvas: HTMLCanvasElement) => HTMLCanvasElement;
  /** Ausgabe-Koordinate → Koordinate im Eingangsbild (Pixel) */
  toSource: (x: number, y: number) => { x: number; y: number };
  lines: number;
}

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

function components(bin: Uint8Array, w: number, h: number, label: Int32Array): Comp[] {
  const comps: Comp[] = [];
  const stack = new Int32Array(w * h);
  label.fill(0);
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || label[i]) continue;
    const id = comps.length + 1;
    const c: Comp = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp) {
      const k = stack[--sp];
      const x = k % w;
      const y = (k - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && bin[k - 1] && !label[k - 1]) { label[k - 1] = id; stack[sp++] = k - 1; }
      if (x < w - 1 && bin[k + 1] && !label[k + 1]) { label[k + 1] = id; stack[sp++] = k + 1; }
      if (y > 0 && bin[k - w] && !label[k - w]) { label[k - w] = id; stack[sp++] = k - w; }
      if (y < h - 1 && bin[k + w] && !label[k + w]) { label[k + w] = id; stack[sp++] = k + w; }
    }
    comps.push(c);
  }
  return comps;
}

function otsu(gray: Uint8ClampedArray | Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Least-Squares-Polynom 2. Grades, x zentriert. */
function fitQuad(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx;
    const x2 = x * x;
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += ys[i]; t1 += x * ys[i]; t2 += x2 * ys[i];
  }
  // Normalgleichungen 3x3 lösen
  const A = [
    [n, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-9) return null;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  const a = A[0][3] / A[0][0];
  const b = A[1][3] / A[1][1];
  const c2 = A[2][3] / A[2][2];
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx;
    const d = ys[i] - (a + b * x + c2 * x * x);
    rss += d * d;
  }
  return { mx, a, b, c: c2, rms: Math.sqrt(rss / n) };
}

interface TextLine {
  x0: number;
  x1: number;
  f: { mx: number; a: number; b: number; c: number };
  xs: number[];
  ys: number[];
}

const evalLine = (l: TextLine, x: number) => {
  // innerhalb: Polynom, außerhalb: linear mit Randsteigung fortsetzen
  const cx = Math.min(l.x1, Math.max(l.x0, x));
  const u = cx - l.f.mx;
  const y = l.f.a + l.f.b * u + l.f.c * u * u;
  const slope = l.f.b + 2 * l.f.c * u;
  return y + slope * (x - cx);
};

export function computeDewarp(src: HTMLCanvasElement): DewarpResult | null {
  const W = src.width;
  const H = src.height;
  const s = Math.min(1, 1600 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s));
  const h = Math.max(1, Math.round(H * s));
  const small = makeCanvas(w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const thr = otsu(gray);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] < thr ? 1 : 0;

  // Zeichen finden, typische Zeichenhöhe bestimmen
  const label = new Int32Array(w * h);
  const comps = components(bin, w, h, label);
  const hs = comps.filter((c) => c.n > 6 && c.y1 - c.y0 > 3 && c.y1 - c.y0 < h / 15 && c.x1 - c.x0 < w / 10).map((c) => c.y1 - c.y0 + 1);
  if (hs.length < 40) return null;
  hs.sort((a, b) => a - b);
  const charH = hs[Math.floor(hs.length * 0.6)];

  // Nur zeichengroße Komponenten behalten (Ränder, Bilder, Buchkante entfernen)
  const keep = new Uint8Array(comps.length + 1);
  comps.forEach((c, i) => {
    const ch = c.y1 - c.y0 + 1;
    const cw = c.x1 - c.x0 + 1;
    keep[i + 1] = ch >= charH * 0.25 && ch <= charH * 2.2 && cw <= charH * 4 && c.n > 3 ? 1 : 0;
  });
  const glyph = new Uint8Array(w * h);
  for (let i = 0; i < glyph.length; i++) glyph[i] = label[i] && keep[label[i]] ? 1 : 0;

  // Waagerecht verschmieren: Lücken bis ~1 Zeichenhöhe schließen (Wörter einer Zeile verbinden)
  const gapMax = Math.round(charH * 1.1);
  const smear = new Uint8Array(glyph);
  for (let y = 0; y < h; y++) {
    let last = -1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (glyph[row + x]) {
        if (last >= 0 && x - last > 1 && x - last <= gapMax) for (let k = last + 1; k < x; k++) smear[row + k] = 1;
        last = x;
      }
    }
  }
  // Vertikal leicht ausdünnen, damit sich Nachbarzeilen nicht berühren (Erosion um 1 px)
  const eroded = new Uint8Array(smear.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      eroded[k] = smear[k] && smear[k - w] && smear[k + w] ? 1 : 0;
    }

  const segs = components(eroded, w, h, label);
  const candidates: TextLine[] = [];
  segs.forEach((c, i) => {
    const sw = c.x1 - c.x0 + 1;
    const sh = c.y1 - c.y0 + 1;
    if (sw < charH * 5 || sh > charH * 2.6 || sh < charH * 0.4) return;
    const id = i + 1;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = c.x0; x <= c.x1; x += 2) {
      let top = -1;
      let bot = -1;
      for (let y = c.y0; y <= c.y1; y++) {
        if (label[y * w + x] === id) {
          if (top < 0) top = y;
          bot = y;
        }
      }
      if (top >= 0) {
        xs.push(x);
        ys.push((top + bot) / 2);
      }
    }
    if (xs.length < 6) return;
    const f = fitQuad(xs, ys);
    if (!f || f.rms > charH * 0.45) return;
    candidates.push({ x0: c.x0, x1: c.x1, f, xs, ys });
  });
  if (candidates.length < 3) return null;

  // Stücke derselben Zeile (z. B. durch große Lücken getrennt) zusammenführen
  candidates.sort((a, b) => a.x0 - b.x0);
  const merged: TextLine[] = [];
  for (const c of candidates) {
    const target = merged.find((m) => {
      if (c.x0 < m.x1 - charH) return false; // überlappt → andere Zeile
      if (c.x0 - m.x1 > w * 0.25) return false;
      const xm = (m.x1 + c.x0) / 2;
      return Math.abs(evalLine(m, xm) - evalLine(c, xm)) < charH * 0.5;
    });
    if (target) {
      const xs = [...target.xs, ...c.xs];
      const ys = [...target.ys, ...c.ys];
      const f = fitQuad(xs, ys);
      if (f && f.rms <= charH * 0.5) {
        target.xs = xs;
        target.ys = ys;
        target.f = f;
        target.x1 = Math.max(target.x1, c.x1);
        continue;
      }
    }
    merged.push({ ...c });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  for (const l of merged) {
    minX = Math.min(minX, l.x0);
    maxX = Math.max(maxX, l.x1);
  }
  const textW = maxX - minX;
  let lines = merged.filter((l) => l.x1 - l.x0 >= textW * 0.4);
  if (lines.length < 3) return null;
  const cx = (minX + maxX) / 2;
  // Plausibilität: Steigungen nicht extrem
  lines = lines.filter((l) => Math.abs(l.f.b) < 0.18 && Math.abs(l.f.c) * textW < 0.25);
  // Reihenfolge nach Höhe in der Mitte; sich kreuzende Linien entfernen (kürzere fällt weg)
  const ref = (l: TextLine) => evalLine(l, cx);
  lines.sort((a, b) => ref(a) - ref(b));
  const probe = [minX, minX + textW * 0.25, cx, minX + textW * 0.75, maxX];
  let changed = true;
  while (changed && lines.length >= 3) {
    changed = false;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      const minGap = Math.min(...probe.map((x) => evalLine(b, x) - evalLine(a, x)));
      if (minGap < charH * 0.6) {
        lines.splice(a.x1 - a.x0 < b.x1 - b.x0 ? i : i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  if (lines.length < 3) return null;

  // Wie stark weicht die Seite überhaupt von waagerecht ab?
  let maxDev = 0;
  for (const l of lines) for (const x of probe) maxDev = Math.max(maxDev, Math.abs(evalLine(l, x) - ref(l)));
  if (maxDev < charH * 0.15) return null; // praktisch gerade – nichts zu tun

  // Abbildung in voller Auflösung
  const refs = lines.map((l) => ref(l) / s);
  const srcY = (x: number, Y: number) => {
    const xs = x * s;
    const n = lines.length;
    if (Y <= refs[0]) return Y + (evalLine(lines[0], xs) / s - refs[0]);
    if (Y >= refs[n - 1]) return Y + (evalLine(lines[n - 1], xs) / s - refs[n - 1]);
    let i = 0;
    while (i < n - 2 && refs[i + 1] < Y) i++;
    const t = (Y - refs[i]) / (refs[i + 1] - refs[i]);
    const v0 = evalLine(lines[i], xs) / s;
    const v1 = evalLine(lines[i + 1], xs) / s;
    return v0 + t * (v1 - v0);
  };

  const apply = (input: HTMLCanvasElement) => {
  const sctxFull = input.getContext('2d', { willReadFrequently: true })!;
  const sd = sctxFull.getImageData(0, 0, W, H).data;
  const out = makeCanvas(W, H);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(W, H);
  const od = img.data;
  const n = lines.length;
  const vals = new Float64Array(n);
  for (let x = 0; x < W; x++) {
    const xs = x * s;
    for (let i = 0; i < n; i++) vals[i] = evalLine(lines[i], xs) / s;
    let i = 0;
    for (let Y = 0; Y < H; Y++) {
      let y: number;
      if (Y <= refs[0]) y = Y + vals[0] - refs[0];
      else if (Y >= refs[n - 1]) y = Y + vals[n - 1] - refs[n - 1];
      else {
        while (i < n - 2 && refs[i + 1] < Y) i++;
        const t = (Y - refs[i]) / (refs[i + 1] - refs[i]);
        y = vals[i] + t * (vals[i + 1] - vals[i]);
      }
      const o = (Y * W + x) * 4;
      if (y < 0 || y > H - 1) {
        od[o] = od[o + 1] = od[o + 2] = 255;
        od[o + 3] = 255;
        continue;
      }
      const y0 = Math.floor(y);
      const ty = y - y0;
      const y1 = Math.min(H - 1, y0 + 1);
      const a = (y0 * W + x) * 4;
      const b = (y1 * W + x) * 4;
      od[o] = sd[a] * (1 - ty) + sd[b] * ty;
      od[o + 1] = sd[a + 1] * (1 - ty) + sd[b + 1] * ty;
      od[o + 2] = sd[a + 2] * (1 - ty) + sd[b + 2] * ty;
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
  };
  return { apply, toSource: (x, y) => ({ x, y: srcY(x, y) }), lines: lines.length };
}
