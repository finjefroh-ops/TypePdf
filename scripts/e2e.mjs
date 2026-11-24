// End-to-End-Test: erzeugt realistische Testbilder von Buchseiten, lädt sie in die App,
// führt die OCR aus, prüft die Erkennungsgenauigkeit und den PDF-Export.
// Aufruf: npm run build && npm test   (Ausgaben in ./test-output)
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Playwright wird nicht als Projektabhängigkeit installiert (npm i -D playwright bei Bedarf)
const { chromium } = createRequire(import.meta.url)('playwright');

const OUT = join(process.cwd(), 'test-output');
mkdirSync(OUT, { recursive: true });
const PORT = 4179;

const PAGE1 = {
  heading: 'Die Bibliothek am Fluss',
  lines: [
    'In der kleinen Stadt an der Weser gab es eine Bibliothek,',
    'die älter war als alle Häuser in ihrer Umgebung. Ihre Mauern',
    'bestanden aus grauem Sandstein, und über dem Eingang hing',
    'ein schmiedeeisernes Schild, auf dem in großen Buchstaben',
    'das Wort „Lesesaal“ stand. Jeden Morgen öffnete Frau Köhler',
    'die schwere Tür, prüfte die Fenster und begrüßte die ersten',
    'Besucher mit einem freundlichen Nicken.',
    '¶Die Schülerinnen und Schüler kamen meist am Nachmittag.',
    'Sie saßen an den langen Tischen, schrieben Aufsätze über',
    'Gedichte und suchten in dicken Lexika nach Begriffen, die',
    'ihnen im Unterricht begegnet waren. Manchmal flüsterten sie,',
    'doch meistens war es so still, dass man das Ticken der Uhr',
    'über dem Ausgang hören konnte.',
  ],
  footnote: '1 Die Bibliothek wurde im Jahr 1874 gegründet.',
  pageNo: '23',
};

const PAGE2 = {
  heading: 'Ein Gespräch über Bücher',
  lines: [
    '„Warum liest du eigentlich so gern?“, fragte Jonas seine',
    'Großmutter, als sie gemeinsam im Garten saßen. Sie legte',
    'ihr Buch zur Seite und überlegte eine Weile. „Weil ich beim',
    'Lesen an Orte reisen kann, die ich sonst nie sehen würde.',
    'Außerdem lerne ich Menschen kennen, die ganz anders denken',
    'als ich.“ Jonas nickte, obwohl er nicht sicher war, ob er',
    'das wirklich verstand.',
    '¶Am nächsten Tag lieh er sich sein erstes eigenes Buch aus.',
    'Es handelte von einem Mädchen, das mit einem Floß über',
    'einen großen See fuhr. Jonas las bis spät in die Nacht.',
  ],
  pageNo: '24',
};

const COLS = {
  heading: 'Wetter und Klima',
  left: [
    'Das Wetter beschreibt den',
    'Zustand der Atmosphäre an',
    'einem bestimmten Ort zu einer',
    'bestimmten Zeit. Es ändert',
    'sich oft innerhalb weniger',
    'Stunden.',
  ],
  right: [
    'Das Klima dagegen fasst das',
    'Wetter über einen langen',
    'Zeitraum zusammen, meist',
    'über dreißig Jahre. Es',
    'bestimmt, welche Pflanzen',
    'und Tiere dort leben können.',
  ],
};

function bookHtml(p, { lineNos = true } = {}) {
  let n = 0;
  const rows = p.lines
    .map((l) => {
      const para = l.startsWith('¶');
      const t = para ? l.slice(1) : l;
      n++;
      const num = lineNos && n % 5 === 0 ? `<span class="ln">${n}</span>` : '';
      return `<div class="row${para ? ' para' : ''}">${num}${t}</div>`;
    })
    .join('');
  return `<html><head><style>
    body{margin:0;background:#f4f1ea;}
    .pg{width:1300px;height:1800px;padding:130px 150px 0 190px;box-sizing:border-box;position:relative;font-family:'Liberation Serif','DejaVu Serif',serif;color:#1b1b1b;}
    h1{font-size:46px;font-weight:bold;margin:40px 0 46px 0}
    .row{font-size:30px;line-height:46px;position:relative;white-space:nowrap}
    .row.para{margin-top:20px;text-indent:36px}
    .ln{position:absolute;left:-90px;font-size:22px;width:50px;text-align:right;text-indent:0}
    .fn{position:absolute;left:190px;bottom:230px;font-size:21px;border-top:1px solid #333;padding-top:10px;width:900px}
    .no{position:absolute;bottom:120px;left:0;right:0;text-align:center;font-size:24px}
  </style></head><body><div class="pg"><h1>${p.heading}</h1>${rows}
  ${p.footnote ? `<div class="fn">${p.footnote}</div>` : ''}<div class="no">${p.pageNo}</div></div></body></html>`;
}

const CURVED = {
  heading: 'Exkurs: Wasser als Lebensgrundlage',
  sub1: 'a) Der Wasserkreislauf in der Natur',
  p1: [
    'Wasser verdunstet über Meeren und Seen, steigt als Dampf auf und',
    'bildet Wolken. Fällt es als Regen zurück, versickert ein Teil im Boden',
    'und speist das Grundwasser. So schließt sich der Kreislauf.',
  ],
  sub2: 'b) Trinkwasser in Deutschland',
  p2: [
    'Rund zwei Drittel unseres Trinkwassers stammen aus Grundwasser. Es',
    'wird in Wasserwerken gereinigt, geprüft und über lange Leitungen zu',
    'den Haushalten gepumpt. Täglich verbraucht jeder Mensch etwa 125 Liter.',
  ],
};

function curvedHtml(p) {
  const rows = (ls) => ls.map((l) => `<div class="r">${l}</div>`).join('');
  return `<html><head><style>
    body{margin:0;background:#f2efe8}
    .pg{width:1400px;height:1100px;padding:90px 110px;box-sizing:border-box;font-family:'Liberation Sans',Arial,sans-serif;color:#1a1a1a}
    h1{font-size:40px;color:#1d4f91;font-weight:bold;margin:0 0 26px}
    .s{font-size:31px;font-weight:bold;margin-top:10px}
    .r{font-size:31px;line-height:46px;white-space:nowrap}
  </style></head><body><div class="pg"><h1>${p.heading}</h1>
  <div class="s">${p.sub1}</div>${rows(p.p1)}<div class="s">${p.sub2}</div>${rows(p.p2)}</div></body></html>`;
}

function colsHtml(p) {
  return `<html><head><style>
    body{margin:0;background:#fff}
    .pg{width:1300px;height:1100px;padding:120px 130px;box-sizing:border-box;font-family:'Liberation Sans',Arial,sans-serif;color:#111}
    h1{font-size:44px;margin:0 0 40px}
    .cols{display:flex;gap:90px}
    .c div{font-size:30px;line-height:44px;white-space:nowrap}
  </style></head><body><div class="pg"><h1>${p.heading}</h1><div class="cols">
  <div class="c">${p.left.map((l) => `<div>${l}</div>`).join('')}</div>
  <div class="c">${p.right.map((l) => `<div>${l}</div>`).join('')}</div></div></div></body></html>`;
}

/** Simuliert ein Handyfoto: leichte Drehung, Schatten, Rauschen, JPEG. */
async function photograph(browser, html, file, { angle = 0, shadow = false, w = 1300, h = 1800, scale = 1, blur = 0, curve = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png' });
  const dataUrl = await page.evaluate(
    async ({ b64, angle, shadow, scale, blur, curve }) => {
      let img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      if (curve) {
        // Wölbung wie bei einem aufgeschlagenen Buch: Zeilen biegen sich zum Rand hin
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#f2efe8';
        cx.fillRect(0, 0, cv.width, cv.height);
        for (let x = 0; x < img.width; x += 2) {
          const u = x / img.width - 0.5;
          const dy = curve * (u * u * 4 - 0.3) + curve * 0.35 * u;
          cx.drawImage(img, x, 0, 2, img.height, x, dy, 2, img.height);
        }
        img = cv;
      }
      const c = document.createElement('canvas');
      c.width = img.width + 160;
      c.height = img.height + 160;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#5b5650';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (shadow) {
        const g = ctx.createLinearGradient(0, 0, c.width, c.height * 0.4);
        g.addColorStop(0, 'rgba(0,0,0,0.38)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 18;
        d.data[i] += n;
        d.data[i + 1] += n;
        d.data[i + 2] += n;
      }
      ctx.putImageData(d, 0, 0);
      if (scale === 1 && !blur) return c.toDataURL('image/jpeg', 0.86);
      const s2 = document.createElement('canvas');
      s2.width = Math.round(c.width * scale);
      s2.height = Math.round(c.height * scale);
      const x2 = s2.getContext('2d');
      x2.filter = blur ? `blur(${blur}px)` : 'none';
      x2.drawImage(c, 0, 0, s2.width, s2.height);
      return s2.toDataURL('image/jpeg', 0.6);
    },
    { b64: png.toString('base64'), angle, shadow, scale, blur, curve },
  );
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.close();
}

/** Zeichenfehlerrate über Levenshtein-Distanz. */
function cer(ref, hyp) {
  const a = [...ref];
  const b = [...hyp];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

async function main() {
  const browser = await chromium.launch();
  const f1 = join(OUT, 'IMG_0002.jpg');
  const f2 = join(OUT, 'IMG_0010.jpg');
  const f3 = join(OUT, 'IMG_0001.jpg');
  const f4 = join(OUT, 'IMG_0020.jpg');
  const f5 = join(OUT, 'IMG_0030.jpg');
  await photograph(browser, bookHtml(PAGE1), f1, { angle: 0.6 });
  await photograph(browser, bookHtml(PAGE2, { lineNos: true }), f2, { angle: -2.2, shadow: true });
  await photograph(browser, colsHtml(COLS), f3, { w: 1300, h: 1100 });
  await photograph(browser, bookHtml(PAGE2, { lineNos: false }), f4, { angle: 1, scale: 0.38, blur: 0.9 });
  await photograph(browser, curvedHtml(CURVED), f5, { w: 1400, h: 1100, curve: 34, angle: 1.5, shadow: true });
  console.log('Testbilder erzeugt');

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await new Promise((res) => {
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && res());
    setTimeout(res, 5000);
  });

  let failures = 0;
  const check = (ok, msg) => {
    console.log(`${ok ? '✓' : '✗'} ${msg}`);
    if (!ok) failures++;
  };

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
    await page.goto(`http://localhost:${PORT}/`);
    await page.screenshot({ path: join(OUT, '01-start.png') });

    await page.setInputFiles('input[type=file]', [f1, f2, f3, f4, f5]);
    await page.waitForSelector('[data-testid=page-card] img');
    await page.waitForTimeout(800);
    const names = await page.$$eval('[data-testid=page-card] .truncate', (els) => els.map((e) => e.textContent));
    check(names.join(',') === 'IMG_0001.jpg,IMG_0002.jpg,IMG_0010.jpg,IMG_0020.jpg,IMG_0030.jpg', `natürliche Sortierung: ${names.join(', ')}`);
    await page.screenshot({ path: join(OUT, '02-seiten.png') });

    // Seite 3 (schräg) automatisch begradigen
    await page.locator('[data-testid=edit-image]').nth(2).click();
    await page.getByRole('button', { name: 'Automatisch' }).click();
    await page.waitForFunction(() => !document.querySelector('[role=dialog] .animate-spin'), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const skewTxt = await page.locator('[role=dialog] .tabular-nums').textContent();
    check(Math.abs(parseFloat(skewTxt) - 2.2) < 0.6, `Auto-Begradigung erkennt ca. 2,2° → ${skewTxt}`);
    await page.screenshot({ path: join(OUT, '03-bild-bearbeiten.png') });
    await page.locator('[data-testid=apply-image]').click();

    // Seiten in Buchreihenfolge: Spalten-Seite nach hinten ziehen ist per Test schwer – Reihenfolge bleibt.
    const t0 = Date.now();
    await page.locator('[data-testid=start-ocr]').click();
    await page.waitForSelector('[data-testid=ocr-progress]', { timeout: 10000 });
    await page.screenshot({ path: join(OUT, '04-ocr-fortschritt.png') });
    await page.waitForSelector('[data-testid=ocr-progress]', { state: 'detached', timeout: 600000 });
    console.log(`OCR für 5 Seiten: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.waitForTimeout(500);

    const pageTexts = async () =>
      page.$$eval('[data-testid=block-list] textarea', (els) => els.map((e) => e.value));
    const pageInfo = async () =>
      page.$$eval('[data-testid=block-list] select', (els) => els.map((e) => e.value));

    // Seite 1 (zweispaltig)
    let texts = await pageTexts();
    const colsTruth = `${COLS.heading} ${COLS.left.join(' ')} ${COLS.right.join(' ')}`;
    const colsOcr = norm(texts.join(' '));
    const c1 = cer(colsTruth, colsOcr);
    check(c1 < 0.03, `Zweispaltig: Reihenfolge & Text, CER ${(c1 * 100).toFixed(2)} %`);
    console.log('   ', colsOcr.slice(0, 160));
    check((await pageInfo())[0] === 'h1' || (await pageInfo())[0] === 'h2', `Zweispaltig: Überschrift erkannt (${(await pageInfo()).join(',')})`);
    await page.screenshot({ path: join(OUT, '05-editor-spalten.png') });

    // Seite 2 (Buchseite mit Zeilennummern, Fußnote, Seitenzahl)
    await page.getByLabel('Nächste Seite').click();
    await page.waitForTimeout(400);
    texts = await pageTexts();
    const types = await pageInfo();
    const body1 = PAGE1.lines.map((l) => l.replace('¶', '')).join(' ');
    const ocr1 = norm(texts.filter((_, i) => types[i] === 'p').join(' '));
    const c2 = cer(body1, ocr1);
    check(c2 < 0.02, `Buchseite: Fließtext CER ${(c2 * 100).toFixed(2)} %`);
    check(!/\b(5|10)\b/.test(ocr1), 'Buchseite: Randzeilennummern nicht im Text');
    check(/[äöüß„“]/.test(ocr1) && ocr1.includes('begrüßte') && ocr1.includes('„Lesesaal“'), 'Buchseite: Umlaute, ß und Anführungszeichen korrekt');
    check(types.includes('h1') || types.includes('h2'), `Buchseite: Überschrift (${types.join(',')})`);
    check(types.includes('footnote'), 'Buchseite: Fußnote erkannt');
    const gutter = await page.$$eval('.hl-gutter div', (els) => els.map((e) => e.textContent).filter(Boolean));
    check(gutter.includes('5') && gutter.includes('10'), `Buchseite: Originalzeilennummern zugeordnet (${gutter.join(',')})`);
    const header = await page.locator('text=Buchseite 23').count();
    check(header > 0, 'Buchseite: Seitenzahl 23 erkannt');
    await page.screenshot({ path: join(OUT, '06-editor-buchseite.png'), fullPage: false });

    // Seite 3 (schräg + Schatten)
    await page.getByLabel('Nächste Seite').click();
    await page.waitForTimeout(400);
    texts = await pageTexts();
    const types3 = await pageInfo();
    const body2 = PAGE2.lines.map((l) => l.replace('¶', '')).join(' ');
    const ocr2 = norm(texts.filter((_, i) => types3[i] === 'p').join(' '));
    const c3 = cer(body2, ocr2);
    check(c3 < 0.03, `Schräges Foto mit Schatten: CER ${(c3 * 100).toFixed(2)} %`);
    console.log('   ', ocr2.slice(0, 160));

    // Bearbeiten: Text ändern, darf nicht überschrieben werden
    const firstP = page.locator('[data-testid=block-list] textarea').nth(types3.indexOf('p'));
    await firstP.click();
    await firstP.press('End');
    await firstP.type(' [geprüft]');
    await page.locator('[data-testid=step-pdf]').click();
    await page.waitForSelector('[data-testid=preview] canvas', { timeout: 60000 });
    await page.locator('[data-testid=step-editor]').click();
    await page.waitForTimeout(300);
    const after = await page.locator('[data-testid=block-list] textarea').nth(types3.indexOf('p')).inputValue();
    check(after.includes('[geprüft]'), 'Bearbeitung bleibt beim Wechsel Editor ↔ PDF erhalten');

    // Seite 4: unscharfes, kleines Foto → unsichere Stellen müssen markiert sein
    await page.getByLabel('Nächste Seite').click();
    await page.waitForTimeout(400);
    const ocr4 = norm((await pageTexts()).join(' '));
    const c4 = cer(`${PAGE2.heading} ${body2}`, ocr4);
    console.log(`    Unscharfes Foto: CER ${(c4 * 100).toFixed(2)} %`);
    const marks = await page.$$eval('.hl-backdrop mark', (els) => els.map((e) => e.textContent));
    const total = await page.locator('[data-testid=uncertain-total]').textContent();
    console.log(`    markiert: ${marks.slice(0, 12).join(' | ')} … (${total.trim()})`);
    check(c4 < 0.01 || marks.length > 0, 'Unscharfes Foto: Fehler werden als unsicher markiert');
    await page.screenshot({ path: join(OUT, '06b-editor-unsicher.png') });

    // Seite 5: gewölbte Seite mit blauer Überschrift und fetten Zwischenüberschriften
    await page.getByLabel('Nächste Seite').click();
    await page.waitForTimeout(400);
    const t5 = await pageTexts();
    const ty5 = await pageInfo();
    const truth5 = [CURVED.heading, CURVED.sub1, ...CURVED.p1, CURVED.sub2, ...CURVED.p2].join(' ');
    const c5 = cer(truth5, norm(t5.join(' ')));
    check(c5 < 0.01, `Gewölbte Seite: CER ${(c5 * 100).toFixed(2)} %`);
    check(ty5.join(',') === 'h1,h2,p,h2,p', `Gewölbte Seite: Struktur Überschrift/Zwischenüberschrift/Absatz (${ty5.join(',')})`);
    await page.screenshot({ path: join(OUT, '06c-editor-gewoelbt.png') });

    // Nächste unsichere Stelle
    await page.getByLabel('Seite wählen').selectOption({ index: 0 });
    await page.waitForTimeout(300);
    if (marks.length) {
      await page.locator('[data-testid=next-uncertain]').click();
      await page.waitForTimeout(600);
      const sel = await page.evaluate(() => {
        const el = document.activeElement;
        return el && el.tagName === 'TEXTAREA' ? el.value.slice(el.selectionStart, el.selectionEnd) : null;
      });
      check(!!sel, `„Nächste unsichere Stelle“ springt zur Markierung und wählt sie aus („${sel}“)`);
    }

    // PDF
    await page.locator('[data-testid=step-pdf]').click();
    await page.locator('[data-testid=file-name]').fill('Lesebuch Kapitel 3');
    await page.locator('[data-testid=line-numbers]').selectOption('document');
    await page.waitForTimeout(1200);
    await page.waitForSelector('[data-testid=preview] canvas');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, '07-pdf-vorschau.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=download]').click()]);
    check(dl.suggestedFilename() === 'Lesebuch Kapitel 3.pdf', `Dateiname: ${dl.suggestedFilename()}`);
    const pdfPath = join(OUT, 'export-text.pdf');
    await dl.saveAs(pdfPath);
    const info = execFileSync('pdfinfo', [pdfPath]).toString();
    const pagesN = Number(info.match(/Pages:\s+(\d+)/)[1]);
    check(pagesN === 5, `PDF hat 5 Seiten (eine je Vorlagenseite): ${pagesN}`);
    check(/595\.\d+ x 841\.\d+/.test(info), 'PDF ist DIN A4');
    const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
    writeFileSync(join(OUT, 'export-text.txt'), txt);
    check(txt.includes('begrüßte') && txt.includes('Großmutter'), 'PDF-Text durchsuchbar mit Umlauten/ß');
    check(/^\s*5\s{2,}/m.test(txt) && /^\s*10\s{2,}/m.test(txt), 'PDF: Zeilennummern alle 5 Zeilen');
    const nums = [...txt.matchAll(/^ *(\d+) {2,}\S/gm)].map((m) => Number(m[1]));
    check(nums.length > 0 && nums.every((n) => n % 5 === 0), `PDF: nur Nummern im 5er-Raster (${nums.join(',')})`);

    // Original-Zeilennummern + Buchseitenzahlen
    await page.locator('[data-testid=line-numbers]').selectOption('original');
    await page.getByRole('button', { name: 'Buchseiten' }).click();
    await page.waitForTimeout(1800);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=download]').click()]);
    const pdf2 = join(OUT, 'export-original-nummern.pdf');
    await dl2.saveAs(pdf2);
    const txt2 = execFileSync('pdftotext', ['-layout', pdf2, '-']).toString();
    writeFileSync(join(OUT, 'export-original-nummern.txt'), txt2);
    check(/\b23\s*$/m.test(txt2) && /\b24\s*$/m.test(txt2), 'PDF: Buchseitenzahlen 23/24 übernommen');
    await page.screenshot({ path: join(OUT, '08-pdf-original.png') });

    // Bildmodus
    await page.getByRole('button', { name: 'Originalbilder' }).click();
    await page.waitForTimeout(3000);
    const [dl3] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=download]').click()]);
    const pdf3 = join(OUT, 'export-bild.pdf');
    await dl3.saveAs(pdf3);
    const txt3 = execFileSync('pdftotext', [pdf3, '-']).toString();
    check(txt3.includes('Bibliothek') && txt3.includes('Klima'), 'Bild-PDF enthält durchsuchbare Textebene');
    await page.screenshot({ path: join(OUT, '09-pdf-bild.png') });

    // Wiederherstellung nach Neuladen
    await page.reload();
    await page.waitForTimeout(1500);
    const restored = await page.locator('[data-testid=step-pdf]').count();
    check(restored > 0, 'Projekt nach Neuladen wiederhergestellt');

    // iPad-Ansicht
    const ipad = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true });
    const ip = await ipad.newPage();
    await ip.goto(`http://localhost:${PORT}/`);
    await ip.setInputFiles('input[type=file]', [f1]);
    await ip.waitForSelector('[data-testid=page-card] img');
    await ip.screenshot({ path: join(OUT, '10-ipad-seiten.png') });
    const overflow = await ip.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'iPad: kein horizontales Scrollen');
  } finally {
    server.kill();
    await browser.close();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
