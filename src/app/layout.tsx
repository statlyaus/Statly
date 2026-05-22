import type { ReactNode } from 'react';

import { type Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import '@/index.css';

const geist = Geist({ subsets: ['latin'] });
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-data-table',
});

export const metadata: Metadata = {
  title: 'Statly',
  description: 'Fantasy AFL gameplay and a separate AFL Draft & Trade Hub.',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={`${geist.className} ${geistMono.variable}`} suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-primary focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
