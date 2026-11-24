import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

type P = SVGProps<SVGSVGElement>;
export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M12 15V4m0 0-4 4m4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
);
export const IconRotateLeft = (p: P) => (
  <svg {...base(p)}><path d="M3 4v5h5" /><path d="M3.5 13a8.5 8.5 0 1 0 2.2-6.3L3 9" /></svg>
);
export const IconRotateRight = (p: P) => (
  <svg {...base(p)}><path d="M21 4v5h-5" /><path d="M20.5 13a8.5 8.5 0 1 1-2.2-6.3L21 9" /></svg>
);
export const IconCrop = (p: P) => (
  <svg {...base(p)}><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
);
export const IconReplace = (p: P) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5" /></svg>
);
export const IconEdit = (p: P) => (
  <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
);
export const IconGrip = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>
);
export const IconChevronLeft = (p: P) => <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>;
export const IconChevronUp = (p: P) => <svg {...base(p)}><path d="m6 15 6-6 6 6" /></svg>;
export const IconChevronDown = (p: P) => <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>;
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconChevronRight = (p: P) => <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>;
export const IconCheck = (p: P) => <svg {...base(p)}><path d="M5 12.5 10 17 19 7" /></svg>;
export const IconX = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IconWarn = (p: P) => (
  <svg {...base(p)}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}><path d="M12 4v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></svg>
);
export const IconText = (p: P) => <svg {...base(p)}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>;
export const IconMerge = (p: P) => <svg {...base(p)}><path d="M8 4v5l4 4 4-4V4M12 13v7" /></svg>;
export const IconSplit = (p: P) => <svg {...base(p)}><path d="M4 12h16M8 8 4 12l4 4M16 8l4 4-4 4" /></svg>;
export const IconPageBreak = (p: P) => (
  <svg {...base(p)}><path d="M6 3v5h12V3M6 21v-5h12v5M3 12h2M8 12h2M14 12h2M19 12h2" /></svg>
);
export const IconWand = (p: P) => (
  <svg {...base(p)}><path d="m4 20 11-11M14 4v2M18 8h2M17 4.5 16 6M19.5 7 18 8M10 4.5 11 6" /></svg>
);
export const IconSpinner = (p: P) => (
  <svg {...base(p)} className={`animate-spin ${p.className ?? ''}`}><path d="M12 3a9 9 0 1 0 9 9" /></svg>
);
