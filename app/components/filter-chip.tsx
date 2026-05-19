'use client';

interface ActiveChipProps {
  label: string;
  onRemove: () => void;
}

export function ActiveFilterChip({ label, onRemove }: ActiveChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] font-medium text-chip-active-text shadow-[0_0_12px_#a78bfa20]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="cursor-pointer text-text-muted hover:text-text-primary"
        aria-label={`Remove filter ${label}`}
      >
        ×
      </button>
    </span>
  );
}

interface AddChipProps {
  onClick?: () => void;
}

export function AddFilterChip({ onClick }: AddChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded-chip border border-dashed border-chip-add-border bg-transparent px-2.5 py-1 text-[11px] text-text-muted hover:text-text-secondary"
    >
      + Filter
    </button>
  );
}
