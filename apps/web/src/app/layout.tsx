import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CupMemo · Your brewing journal',
  description: 'Access your CupMemo account. Brew journaling features are coming later.',
  applicationName: 'CupMemo',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
