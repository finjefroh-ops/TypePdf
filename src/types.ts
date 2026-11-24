export type Rotation = 0 | 90 | 180 | 270;

/** Normalisierter Ausschnitt (0..1) im gedrehten/begradigten Bild. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalisierte Box (0..1) relativ zum für die OCR verwendeten Bild. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BlockType = 'h1' | 'h2' | 'p' | 'footnote' | 'hidden';

/** Unsichere OCR-Stelle als Zeichenbereich im Blocktext. */
export interface Mark {
  start: number;
  end: number;
  /** OCR-Konfidenz 0..100 */
  conf: number;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Text; Zeilenumbrüche (\n) entsprechen den Zeilen der Vorlage. */
  text: string;
  marks: Mark[];
  /** Originale (gedruckte) Zeilennummern, je Textzeile, sonst null. */
  lineNos: (string | null)[];
  /** OCR-Position je ursprünglicher Zeile (für Bildhervorhebung und Textebene). */
  lineBoxes: Box[];
  /** Hinweis, warum ein Block ausgeblendet wurde (z. B. Kopfzeile). */
  note?: string;
  /** Manueller Seitenumbruch vor diesem Block. */
  pageBreakBefore?: boolean;
}

export interface PageDoc {
  blocks: Block[];
  /** Erkannte Buchseitenzahl */
  origPageNo: string | null;
  meanConf: number;
  /** Signatur der Bildbearbeitung zum Zeitpunkt der OCR */
  transformKey: string;
  edited: boolean;
  createdAt: number;
}

export type OcrStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface Page {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  rotation: Rotation;
  /** Begradigung in Grad */
  skew: number;
  crop: Crop | null;
  doc: PageDoc | null;
  status: OcrStatus;
  progress: number;
  error?: string;
  /** Kein Seitenumbruch vor dieser Seite im PDF */
  joinWithPrevious: boolean;
  /** Ersten Absatz mit dem letzten Absatz der vorigen Seite verbinden */
  continueParagraph: boolean;
}

export type Step = 'pages' | 'editor' | 'pdf';

export interface Settings {
  fileName: string;
  pdfMode: 'text' | 'image';
  fontSize: number;
  lineBreaks: 'original' | 'flow';
  pageBreakPerSource: boolean;
  pageNumbers: 'none' | 'center' | 'right';
  pageNumberSource: 'auto' | 'original';
  lineNumbers: 'none' | 'page' | 'document' | 'original';
  lineNumberInterval: 1 | 5;
  uncertainThreshold: number;
  preprocess: boolean;
  psm: '3' | '4' | '6';
}

export const defaultSettings: Settings = {
  fileName: 'Dokument',
  pdfMode: 'text',
  fontSize: 11,
  lineBreaks: 'original',
  pageBreakPerSource: true,
  pageNumbers: 'center',
  pageNumberSource: 'auto',
  lineNumbers: 'none',
  lineNumberInterval: 5,
  uncertainThreshold: 80,
  preprocess: true,
  psm: '3',
};

export const transformKey = (p: Pick<Page, 'rotation' | 'skew' | 'crop'>) =>
  JSON.stringify([p.rotation, Math.round(p.skew * 100) / 100, p.crop ? [p.crop.x, p.crop.y, p.crop.w, p.crop.h].map((v) => Math.round(v * 1000)) : null]);
