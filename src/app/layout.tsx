import type { Metadata } from 'next';

import type { ReactNode } from 'react';

import { Inter } from 'next/font/google';

import '@/index.css';
import { AuthProvider } from '@/AuthContext';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Statly - Fantasy AFL',
  description: 'A fantasy sports platform for the Australian Football League (AFL)',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className}>
        {/* Skip link for keyboard users */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-white focus:text-blue-700 focus:ring-2 focus:ring-blue-600 focus:px-4 focus:py-2 focus:rounded"
        >
          Skip to main content
        </a>
        <PageErrorBoundary name="RootLayout">
          <PerformanceMonitor />
          {/* Primary navigation */}
          {/* Wrap with ToastProvider so toasts are available app-wide */}
          {/** Wrap both Toast and Activity providers/bridges around nav */}
          {require('@/components/Activity/ActivityProvider').ActivityProvider({
            children: require('@/components/Toast/ToastProvider').ToastProvider({
              children: (
                <>
                  {require('@/components/Nav/MainNav').default()}
                  {require('@/components/Toast/ToastBridge').default()}
                  {require('@/components/Activity/ActivityBridge').default()}
                </>
              ),
            }),
          })}
          {/* Landmark: main content */}
          <main id="main" tabIndex={-1} className="outline-none">
            <AuthProvider>{children}</AuthProvider>
          </main>
        </PageErrorBoundary>
      </body>
    </html>
  );
}
