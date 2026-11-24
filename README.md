# TYPEPDF

Fotos und Scans von Buchseiten, Arbeitsblättern und Dokumenten → wortgetreuer Text → schlicht gesetztes, durchsuchbares DIN-A4-PDF.

Alles läuft **lokal im Browser**: Bilder, Texterkennung und PDF-Erzeugung verlassen das Gerät nicht. Kein Konto, keine Wasserzeichen.

## Starten

```bash
npm install      # kopiert dabei OCR-Dateien (Worker, WASM, deutsches Sprachmodell) nach public/ocr
npm run dev      # Entwicklung: http://localhost:5173
npm run build    # statische App in dist/ – auf jedem Webserver lauffähig
npm run preview  # gebaute App lokal ansehen
```

Die gebaute App ist rein statisch (`dist/`) und kann z. B. über GitHub Pages bereitgestellt werden (Workflow in `.github/workflows/deploy.yml`; in den Repository-Einstellungen unter *Pages* als Quelle „GitHub Actions“ wählen).

## Arbeitsablauf

1. **Seiten** – Bilder (JPG, PNG, WEBP) per Drag-and-drop oder Dateiauswahl laden. Sortierung automatisch nach Dateiname (IMG_2 vor IMG_10), danach per Ziehen änderbar oder nach erkannten Buchseitenzahlen. Drehen, Zuschneiden, Begradigen (manuell oder automatisch), Ersetzen, Entfernen.
2. **Text** – Original links, erkannter Text rechts. Unsichere Wörter sind gelb (unter Schwelle) bzw. rot (sehr unsicher) markiert; „Nächste unsichere Stelle“ springt direkt hin und wählt das Wort aus. Wer ein markiertes Wort bearbeitet, bestätigt es damit. Abschnitte lassen sich als Überschrift, Absatz, Fußnote formatieren oder ausblenden, teilen, verbinden und mit Seitenumbrüchen versehen; Seiten lassen sich zusammenführen.
3. **PDF** – Live-Vorschau, Einstellungen, Dateiname, Download mit einem Klick.

## Grundsatz: wortgetreu

Der erkannte Text wird **nicht** zusammengefasst, umformuliert, korrigiert oder ergänzt. Die App erkennt nur Struktur:

- Überschriften (über die Schriftgröße), Absätze, Fußnoten, Kopfzeilen
- Seitenzahlen der Vorlage (werden ausgeblendet und optional als Seitenzahl übernommen)
- gedruckte Zeilennummern am Rand – sie werden nur übernommen, wenn sie zur Zeilenabfolge passen (Nummer − Zeilenindex konstant), sonst bleibt die Zahl als Text erhalten
- Unicode-Ligaturen (ﬁ → fi) werden aufgelöst; sonst bleibt jedes Zeichen, wie es erkannt wurde

Einzige optionale Umformung: Im Modus *Fließtext* werden am Zeilenende getrennte Wörter („Wort-⏎teil“ mit kleinem Folgebuchstaben) zusammengefügt. Im Standardmodus *Wie Vorlage* bleiben alle Zeilen exakt wie im Original.

Bearbeiteter Text wird nie automatisch überschrieben: erneute Erkennung fragt nach und lässt sich rückgängig machen. Das Projekt wird laufend lokal (IndexedDB) gesichert und nach einem Neuladen wiederhergestellt.

## PDF

- DIN A4, weißer Hintergrund, schwarze Schrift, Liberation Sans (metrisch kompatibel zu Arial/Helvetica, eingebettet)
- Fließtext 10,5 / 11 / 11,5 pt, Zeilenabstand 1,45, Ränder 25/20/25/25 mm, automatischer Seitenumbruch (Überschriften bleiben beim folgenden Text, keine einzelne erste Absatzzeile am Seitenende)
- Seitenzahlen: keine / mittig / rechts; fortlaufend (1, 2, 3 …) oder die erkannten Buchseitenzahlen
- Zeilennummern am linken Rand: neu gezählt (pro Seite oder fortlaufend, **standardmäßig alle 5 Zeilen**, wahlweise jede Zeile) oder die Original-Zeilennummern der Vorlage. Originalnummern stehen *kursiv*, neu gezählte aufrecht – die beiden Arten sind nie gleichzeitig aktiv.
- Ausgabe *Neu gesetzt* (echter Text, durchsuchbar und markierbar) oder *Originalbilder* (Fotos mit unsichtbarer, durchsuchbarer Textebene)

## Technik

| Bereich | Lösung |
| --- | --- |
| UI | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Zustand & Sicherung | Zustand, IndexedDB (idb-keyval) |
| Sortieren | dnd-kit (Maus, Touch, Tastatur) |
| OCR | Tesseract.js 7 (LSTM), deutsches Modell `deu`, lokal ausgeliefert (kein CDN) |
| Bildaufbereitung | Canvas: EXIF-Ausrichtung, Drehen/Begradigen/Zuschneiden, Beleuchtungsausgleich, Schräglagenschätzung per Projektionsprofil |
| Randzahlen | zweiter OCR-Durchgang: Zusammenhangskomponenten im Randstreifen, einzelne Ziffernerkennung mit Whitelist, Plausibilitätsprüfung |
| PDF | pdf-lib + fontkit (eingebettete Teilschriften), Vorschau mit pdf.js |

```
src/
  lib/image.ts      Bild laden, transformieren, vorverarbeiten, Schräglage schätzen
  lib/ocr.ts        Tesseract-Worker, Seiten- und Randerkennung
  lib/analyze.ts    OCR-Rohdaten → Abschnitte, Markierungen, Zeilen-/Seitenzahlen
  lib/textedit.ts   Bearbeitung mit mitlaufenden Markierungen und Zeilennummern
  lib/pdf.ts        Satz-Engine (Umbruch, Seitenumbruch, Nummerierung, Bildmodus)
  lib/exporter.ts   Schriften laden, PDF erzeugen, Download
  store.ts          Projektzustand, OCR-Warteschlange, lokale Sicherung
  components/       Upload, Seitenverwaltung, Bildeditor, Texteditor, PDF-Ansicht
```

## Tests

```bash
npm run build && npm test     # End-to-End im Browser (benötigt Playwright + Chromium)
npx tsx scripts/pdf-test.ts   # Satz-Test: langer Text über viele Seiten, kein Wort darf fehlen
```

Der End-to-End-Test erzeugt realistische Testfotos (Buchseite mit Randzeilennummern, Fußnote und Seitenzahl; schräg fotografierte Seite mit Schatten; zweispaltige Seite; unscharfes Foto), lädt sie hoch und prüft u. a. Zeichenfehlerrate, Spaltenreihenfolge, Umlaute/ß/„Anführungszeichen“, Zeilennummern, automatische Begradigung, Datenerhalt beim Wechsel der Ansichten, Wiederherstellung nach Neuladen, PDF-Seitenformat, Durchsuchbarkeit und die iPad-Ansicht. Ausgaben (Screenshots, PDFs) landen in `test-output/`.

## Grenzen

- Sehr unscharfe oder kleine Aufnahmen lassen sich nicht zuverlässig lesen – solche Seiten werden deutlich als schwer lesbar gekennzeichnet statt „geraten“.
- Fett/kursiv im Fließtext wird von der OCR nicht erkannt; Überschriften werden über die Schriftgröße bestimmt.
- Handschrift und Frakturschrift sind nicht Ziel des deutschen Standardmodells.

Schrift: Liberation Sans, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
