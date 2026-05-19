import './globals.css';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { Sidebar } from './components/sidebar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Inventory',
  description: 'Personal purchase + inventory dashboard',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} bg-bg-base text-text-primary`}>
      <body className="min-h-screen font-sans">
        <div className="flex min-h-screen">
          <Suspense fallback={<aside className="hidden w-[170px] border-r border-border-subtle bg-bg-sidebar md:block" />}>
            <Sidebar />
          </Suspense>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
