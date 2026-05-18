import './globals.css';
import Link from 'next/link';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Outdoor Inventory',
  description: 'Personal purchase + inventory dashboard',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-zinc-950 text-zinc-100">
      <body className="min-h-screen">
        <header className="border-b border-zinc-800 bg-zinc-900/70 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold tracking-tight text-zinc-100 hover:text-white">
              Outdoor Inventory
            </Link>
            <Link href="/" className="text-zinc-400 hover:text-zinc-100">Items</Link>
            <Link href="/spending" className="text-zinc-400 hover:text-zinc-100">Spending</Link>
            <Link href="/needs-review" className="text-zinc-400 hover:text-zinc-100">Needs review</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
