import { useEffect, useState } from 'react';
import type { Page } from '../types';
import { canvasToBlob, renderTransformed } from '../lib/image';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

const keyOf = (p: Page) => `${p.id}:${p.rotation}:${p.skew}:${JSON.stringify(p.crop)}:${p.blob.size}`;

/** Gedrehtes/zugeschnittenes Seitenbild als Objekt-URL (zwischengespeichert). */
export function usePageImage(page: Page | null | undefined): string | null {
  const key = page ? keyOf(page) : '';
  const [url, setUrl] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null));
  useEffect(() => {
    if (!page) return;
    const k = keyOf(page);
    const hit = cache.get(k);
    if (hit) {
      setUrl(hit);
      return;
    }
    setUrl(null);
    let cancelled = false;
    let p = pending.get(k);
    if (!p) {
      p = renderTransformed(page, 2000)
        .then((c) => canvasToBlob(c, 'image/jpeg', 0.88))
        .then((b) => {
          const u = URL.createObjectURL(b);
          cache.set(k, u);
          pending.delete(k);
          return u;
        });
      pending.set(k, p);
    }
    p.then((u) => !cancelled && setUrl(u)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
