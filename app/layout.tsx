import './globals.css';
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
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
