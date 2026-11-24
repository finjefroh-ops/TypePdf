/** iOS-artiger Schalter mit Beschriftung. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 py-1 ${disabled ? 'cursor-default opacity-40' : ''}`}>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-[#34c759]' : 'bg-black/[0.12]'}`}
      >
        <span
          className={`absolute top-[2px] left-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2),0_0_1px_rgba(0,0,0,0.2)] transition-transform duration-200 ${checked ? 'translate-x-[18px]' : ''}`}
        />
      </button>
    </label>
  );
}
