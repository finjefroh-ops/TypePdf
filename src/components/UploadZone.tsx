import { useRef, useState } from 'react';
import { useStore } from '../store';
import { isAcceptedFile } from '../lib/image';
import { IconUpload } from './Icons';

export function UploadZone({ compact = false }: { compact?: boolean }) {
  const addFiles = useStore((s) => s.addFiles);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    const ok = all.filter(isAcceptedFile);
    const rejected = all.length - ok.length;
    if (rejected) alert(`${rejected} Datei(en) übersprungen. Unterstützt werden JPG, PNG und WEBP.`);
    if (!ok.length) return;
    setBusy(true);
    try {
      await addFiles(ok);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="upload-zone"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors ${
        over ? 'border-accent bg-white' : 'border-neutral-300 bg-surface hover:border-neutral-400'
      } ${compact ? 'gap-1 px-4 py-5' : 'gap-3 px-6 py-20 sm:py-28'}`}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
      <div className={`flex items-center justify-center rounded-full bg-neutral-100 text-ink ${compact ? 'h-8 w-8' : 'h-12 w-12'}`}>
        <IconUpload width={compact ? 16 : 22} height={compact ? 16 : 22} />
      </div>
      {compact ? (
        <p className="text-sm text-muted">{busy ? 'Bilder werden geladen …' : 'Weitere Seiten hinzufügen – hierher ziehen oder klicken'}</p>
      ) : (
        <>
          <p className="text-lg font-medium">{busy ? 'Bilder werden geladen …' : 'Fotos oder Scans hierher ziehen'}</p>
          <p className="max-w-md text-sm text-muted">
            oder klicken, um Dateien auszuwählen · JPG, PNG, WEBP · mehrere Seiten möglich
          </p>
          <p className="mt-4 max-w-md text-xs text-muted">
            Alle Bilder bleiben auf diesem Gerät. Die Texterkennung läuft vollständig im Browser.
          </p>
        </>
      )}
    </div>
  );
}
