'use client';

interface Props {
  label: string;
  selected: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
}

export function EnumFilter({ label, selected, options, onChange }: Props) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  }
  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label} filter</div>
      <div className="max-h-56 overflow-y-auto">
        {options.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text-body hover:bg-bg-surface-raised">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-accent-from" />
            <span>{opt}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([])}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}
