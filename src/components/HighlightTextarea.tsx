import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { needsReview, type Mark } from '../types';

interface Props {
  text: string;
  marks: Mark[];
  lineNos: (string | null)[];
  threshold: number;
  showGutter: boolean;
  /** Startposition der gerade geprüften Stelle */
  current?: number | null;
  className?: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  onCaret?: (pos: number) => void;
  /** Markierter Bereich im Textfeld (start === end: keine Auswahl) */
  onSelectRange?: (start: number, end: number) => void;
  ariaLabel?: string;
}

export interface HighlightHandle {
  select: (start: number, end: number) => void;
  focus: () => void;
  caret: () => number;
}

/**
 * Textfeld mit farbiger Hervorhebung unsicherer OCR-Stellen.
 * Die Markierungen liegen in einer Ebene hinter dem (transparenten) Textfeld.
 */
export const HighlightTextarea = forwardRef<HighlightHandle, Props>(function HighlightTextarea(
  { text, marks, lineNos, threshold, showGutter, current, className, onChange, onFocus, onCaret, onSelectRange, ariaLabel },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const bd = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    select: (start, end) => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // horizontal zur Markierung scrollen
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const col = start - lineStart;
      el.scrollLeft = Math.max(0, col * 7.5 - el.clientWidth / 2);
      if (bd.current) bd.current.scrollLeft = el.scrollLeft;
    },
    focus: () => ta.current?.focus(),
    caret: () => ta.current?.selectionStart ?? 0,
  }));

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Höhe auch bei Breitenänderung (z. B. iPad drehen) anpassen
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const segments = useMemo(() => {
    const visible = marks.filter((m) => needsReview(m, threshold) && m.end <= text.length).sort((a, b) => a.start - b.start);
    const out: { t: string; cls?: string; title?: string }[] = [];
    let pos = 0;
    for (const m of visible) {
      if (m.start < pos) continue;
      if (m.start > pos) out.push({ t: text.slice(pos, m.start) });
      const kind = m.orig !== undefined ? 'fix' : m.conf < 50 ? 'bad' : 'low';
      out.push({ t: text.slice(m.start, m.end), cls: kind + (m.start === current ? ' cur' : ''), title: `Sicherheit ${m.conf} %` });
      pos = m.end;
    }
    out.push({ t: text.slice(pos) + '\n' });
    return out;
  }, [text, marks, threshold, current]);

  const lineCount = text.split('\n').length;
  const hasLineNos = lineNos.some(Boolean);

  return (
    <div className={`flex ${hasLineNos ? '' : 'hl-soft'} ${className ?? ''}`}>
      {showGutter && (
        <div className="hl-gutter w-8 shrink-0 select-none pr-1.5 text-right text-muted" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={lineNos[i] ? 'italic text-ink/70' : ''}>
              {lineNos[i] ?? (hasLineNos ? '' : '')}
            </div>
          ))}
        </div>
      )}
      <div className="hl-wrap min-w-0 flex-1">
        <div ref={bd} className="hl-backdrop" aria-hidden>
          {segments.map((s, i) =>
            s.cls ? (
              <mark key={i} className={s.cls}>
                {s.t}
              </mark>
            ) : (
              <span key={i}>{s.t}</span>
            ),
          )}
        </div>
        <textarea
          ref={ta}
          className="hl-input"
          value={text}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          wrap={hasLineNos ? 'off' : 'soft'}
          rows={1}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onSelect={(e) => {
            onCaret?.(e.currentTarget.selectionStart);
            onSelectRange?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          }}
          onMouseUp={(e) => onSelectRange?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
          onKeyUp={(e) => onSelectRange?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
          onTouchEnd={(e) => {
            const el = e.currentTarget;
            // iPad: Auswahl steht erst nach dem Loslassen fest
            window.setTimeout(() => onSelectRange?.(el.selectionStart, el.selectionEnd), 350);
          }}
          onScroll={(e) => {
            if (bd.current) bd.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
        />
      </div>
    </div>
  );
});
