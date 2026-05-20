'use client';
import { useEffect } from 'react';

/**
 * Minimal modal primitive — fixed overlay + centered card. Clicking the
 * backdrop or pressing Escape calls onClose. The caller is responsible for
 * controlling open state. No portal: rendered inline so it sits at the end of
 * the body via z-index, which is good enough for an internal tool.
 */
export function Modal({
  open,
  onClose,
  children,
  title,
  maxWidthClass = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while open so the modal feels modal.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-3"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        className={`relative ${maxWidthClass} w-full max-h-[85vh] overflow-y-auto rounded-card border border-border-subtle bg-bg-surface p-5 shadow-card`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          {title ? (
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-text-primary">{title}</h2>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-input px-2 py-1 text-[18px] leading-none text-text-muted hover:bg-bg-surface-raised hover:text-text-primary"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
