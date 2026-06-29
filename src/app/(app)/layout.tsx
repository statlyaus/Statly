import type { ReactNode } from 'react';

import { AuthProvider } from '@/AuthContext';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function AppRouteLayout({ children }: { readonly children: ReactNode }) {
  return (
    <PageErrorBoundary name="AppRouteLayout">
      <PerformanceMonitor />
      <AuthProvider>
        {children}
      </AuthProvider>
    </PageErrorBoundary>
  );
}
