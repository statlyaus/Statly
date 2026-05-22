import type { ReactNode } from 'react';

import { AuthProvider } from '@/AuthContext';
import ActivityBridge from '@/components/Activity/ActivityBridge';
import { ActivityProvider } from '@/components/Activity/ActivityProvider';
import MainNavigation from '@/components/navigation/MainNavigation';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import ToastBridge from '@/components/Toast/ToastBridge';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <PageErrorBoundary name="AppLayout">
      <PerformanceMonitor />
      <AuthProvider>
        <ActivityProvider>
          <ToastProvider>
            <MainNavigation />
            <ToastBridge />
            <ActivityBridge />
          </ToastProvider>
        </ActivityProvider>
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </AuthProvider>
    </PageErrorBoundary>
  );
}
