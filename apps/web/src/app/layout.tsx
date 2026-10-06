import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CupMemo · Development scaffold',
  description: 'CupMemo is a personal coffee brewing journal.',
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
