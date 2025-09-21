import type { Metadata } from 'next';

import type { ReactNode } from 'react';

import { Inter } from 'next/font/google';

import '@/index.css';
import { AuthProvider } from '@/AuthContext';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';
import MainNavigation from '@/components/navigation/MainNavigation';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import ToastBridge from '@/components/Toast/ToastBridge';
import { ActivityProvider } from '@/components/Activity/ActivityProvider';
import ActivityBridge from '@/components/Activity/ActivityBridge';

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
