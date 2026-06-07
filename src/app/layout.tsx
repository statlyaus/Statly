import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

import '@/index.css';

import ClientSentryWrapper from '@/components/ClientSentryWrapper';
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
        <ClientSentryWrapper>
          <PageErrorBoundary name="RootLayout">{children}</PageErrorBoundary>
        </ClientSentryWrapper>
      </body>
    </html>
  );
}
