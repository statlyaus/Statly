import type { ReactNode } from 'react';

import { type Metadata } from 'next';
import { Geist } from 'next/font/google';

import '@/index.css';
import { AuthProvider } from '@/AuthContext';
import ActivityBridge from '@/components/Activity/ActivityBridge';
import { ActivityProvider } from '@/components/Activity/ActivityProvider';
import MainNavigation from '@/components/navigation/MainNavigation';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import ToastBridge from '@/components/Toast/ToastBridge';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

const geist = Geist({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Statly',
  description: 'Fantasy AFL gameplay and a separate AFL Draft & Trade Hub.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={geist.className} suppressHydrationWarning>
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
          {/* Wrap with Auth provider so navigation and content can use useAuth */}
          <AuthProvider>
            {/* Wrap with providers so toasts/activity are available app-wide */}
            <ActivityProvider>
              <ToastProvider>
                <MainNavigation />
                <ToastBridge />
                <ActivityBridge />
              </ToastProvider>
            </ActivityProvider>
            {/* Landmark: main content */}
            <main id="main" tabIndex={-1} className="outline-none">
              {children}
            </main>
          </AuthProvider>
        </PageErrorBoundary>
      </body>
    </html>
  );
}
