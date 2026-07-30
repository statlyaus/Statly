import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import '@/index.css';

import FirebaseAnalyticsInitializer from '@/components/FirebaseAnalyticsInitializer';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Statly - Fantasy AFL',
  description: 'A fantasy sports platform for the Australian Football League (AFL)',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className} suppressHydrationWarning>
        <FirebaseAnalyticsInitializer />
        <PageErrorBoundary name="RootLayout">{children}</PageErrorBoundary>
      </body>
    </html>
  );
}
