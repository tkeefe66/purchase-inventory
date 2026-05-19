'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const DOMAINS = [
  { slug: 'outdoor', label: 'Outdoor', active: true },
  { slug: 'photography', label: 'Photography', active: true },
  { slug: 'kitchen', label: 'Kitchen', active: false },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger trigger — fixed top-left */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 inline-flex items-center justify-center rounded-input border border-border-subtle bg-bg-sidebar p-2.5 text-text-secondary md:hidden"
      >
        <span className="block h-0.5 w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
      </button>

      {/* Backdrop (mobile only, when drawer open) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar — fixed drawer on mobile, sticky column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[200px] flex-shrink-0 border-r border-border-subtle bg-bg-sidebar px-3 py-4 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'} md:w-[170px]`}
      >
        <BrandMark />
        <Section title="Domains" />
        {DOMAINS.map((d) => (
          <DomainLink key={d.slug} {...d} onClick={() => setOpen(false)} />
        ))}
        <Section title="Photography" />
        <NavLink href="/photography" label="Skills" onClick={() => setOpen(false)} />
        <NavLink href="/photography/assignments" label="Assignments" onClick={() => setOpen(false)} />
        <Section title="Everything" />
        <NavLink href="/" label="All items" onClick={() => setOpen(false)} clearDomain />
        <NavLink href="/spending" label="Spending" onClick={() => setOpen(false)} />
        <NavLink href="/needs-review" label="Needs review" onClick={() => setOpen(false)} />
        <Section title="Agent" />
        <span className="block px-2 py-1.5 text-[13px] text-text-muted">
          Chat <span className="ml-1 text-[9px] uppercase tracking-wide">soon</span>
        </span>

        <div className="absolute inset-x-3 bottom-3 border-t border-border-divider pt-2.5 text-[10px] text-text-muted">
          tkeefe66 · v1.4
        </div>
      </aside>
    </>
  );
}

function BrandMark() {
  return (
    <div className="mb-4 flex items-center gap-2 px-2">
      <div className="h-[22px] w-[22px] rounded-[7px] bg-accent-gradient shadow-brand-mark" />
      <span className="text-[17px] font-bold tracking-[-0.025em] text-text-primary">Inventory</span>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="mt-3 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {title}
    </div>
  );
}

function DomainLink({
  slug, label, active, onClick,
}: { slug: string; label: string; active: boolean; onClick: () => void }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const currentDomain = search.get('domain') ?? '';
  const isActive = pathname === '/' && currentDomain === slug;
  return (
    <Link
      href={`/?domain=${slug}`}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-chip px-2 py-1.5 text-[13px] ${
        isActive
          ? 'bg-chip-active font-semibold text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      <span
        className={`h-[7px] w-[7px] rounded-full ${
          isActive ? 'bg-accent-gradient shadow-accent-glow' : 'bg-border-subtle'
        }`}
      />
      {label}
      {!active && <span className="ml-auto text-[10px] text-text-muted">—</span>}
    </Link>
  );
}

function NavLink({
  href, label, onClick, clearDomain = false,
}: { href: string; label: string; onClick: () => void; clearDomain?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentDomain = search.get('domain') ?? '';
  const isActive = pathname === href && (!clearDomain || !currentDomain);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-chip px-2 py-1.5 text-[13px] ${
        isActive
          ? 'bg-chip-active font-semibold text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </Link>
  );
}
