'use client';
import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: React.ReactNode;
}

export function ColumnFilterPopover({ open, onClose, anchor, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchor && !anchor.contains(t)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  // Use position:fixed (viewport coords) so the popover anchors correctly
  // regardless of any ancestor's positioning context (transforms, relative
  // wrappers, flex containers). Clamp `left` so the menu can't escape the
  // right edge of the viewport.
  const POPOVER_WIDTH = 260;
  const top = rect.bottom + 6;
  const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width: POPOVER_WIDTH }}
      className="z-50 rounded-input border border-border-subtle bg-bg-surface p-3 shadow-popover"
    >
      {children}
    </div>
  );
}
