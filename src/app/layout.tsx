import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import '@/index.css';
import '@/lib/sentry'; // Initialize Sentry early
import { AuthProvider } from '@/AuthContext';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';
import SentryErrorBoundary from '@/components/SentryErrorBoundary';
import PerformanceMonitor from '@/components/PerformanceMonitor';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Statly - Fantasy AFL',
  description: 'A fantasy sports platform for the Australian Football League (AFL)',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className}>
        <SentryErrorBoundary>
          <PageErrorBoundary
            name="RootLayout"
          >
            <PerformanceMonitor />
            <AuthProvider>{children}</AuthProvider>
          </PageErrorBoundary>
        </SentryErrorBoundary>
      </body>
    </html>
  );
}
