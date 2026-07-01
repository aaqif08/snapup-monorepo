import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'SnapUp Business — Owner Dashboard',
  description: 'Manage products, staff, and store analytics for your SnapUp locations.',
  icons: {
    icon: '/icon-512.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#00C896',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
