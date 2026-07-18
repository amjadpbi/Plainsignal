import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plainsignal — Etsy keyword research',
  description: 'Honest, data-grounded keyword research for Etsy sellers.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
