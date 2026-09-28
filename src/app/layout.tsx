import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Barlow, Barlow_Condensed } from 'next/font/google';

import '@/index.css';

import FirebaseAnalyticsInitializer from '@/components/FirebaseAnalyticsInitializer';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-barlow',
});
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-barlow-condensed',
});

export const metadata: Metadata = {
  title: 'Statly - Fantasy AFL',
  description: 'A fantasy sports platform for the Australian Football League (AFL)',
  icons: { icon: '/brand/statly-app-icon.png', apple: '/brand/statly-app-icon.png' },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="font-sans" suppressHydrationWarning>
        <FirebaseAnalyticsInitializer />
        <PageErrorBoundary name="RootLayout">{children}</PageErrorBoundary>
      </body>
    </html>
  );
}
