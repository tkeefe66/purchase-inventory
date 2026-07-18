'use client';
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Minimal modal primitive — fixed overlay + centered card. Clicking the
 * backdrop or pressing Escape calls onClose. The caller is responsible for
 * controlling open state. No portal: rendered inline so it sits at the end of
 * the body via z-index, which is good enough for an internal tool.
 *
 * Accessibility: on open, focus moves into the dialog (first focusable
 * element, falling back to the dialog card itself); Tab/Shift+Tab are
 * trapped inside; on close, focus returns to whatever triggered the modal.
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusable = card ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (focusable[0] ?? card)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && card) {
        const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while open so the modal feels modal.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
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
        ref={cardRef}
        tabIndex={-1}
        className={`relative ${maxWidthClass} w-full max-h-[85vh] overflow-y-auto rounded-card border border-border-subtle bg-bg-surface p-5 shadow-card focus:outline-none`}
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
