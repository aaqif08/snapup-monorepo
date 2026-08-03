import type { Metadata, Viewport } from 'next';
import { THEME_INIT_SCRIPT } from '@snapup/ui/theme-runtime';
import './globals.css';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'SnapUp — Scan, Pay & Skip the Line',
  description: 'Scan barcodes, build your cart, and check out without the queue.',
  icons: {
    icon: '/icon-512.png',
    apple: '/apple-touch-icon.png',
  },
};

// Colours the browser chrome to match the theme the phone is actually showing.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#00C896' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1210' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script below sets data-theme before React runs, so
    // the server's markup and the client's first read of <html> legitimately differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="flex min-h-screen flex-col bg-bg">
          <NavBar />
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
