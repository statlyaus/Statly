import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthProvider } from '@/AuthContext';
import LeagueSocialAppProvider from '@/components/league/social/LeagueSocialAppProvider';
import AppLayout from '@/components/navigation/AppLayout';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

export default async function AppRouteLayout({ children }: { readonly children: ReactNode }) {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) {
    const requestPath = (await headers()).get('x-statly-request-path');
    const safeRequestPath =
      requestPath?.startsWith('/') && !requestPath.startsWith('//') ? requestPath : '/';
    redirect(`/login?next=${encodeURIComponent(safeRequestPath)}`);
  }

  return (
    <PageErrorBoundary name="AppRouteLayout">
      <PerformanceMonitor />
      <AuthProvider>
        <LeagueSocialAppProvider>
          <AppLayout>{children}</AppLayout>
        </LeagueSocialAppProvider>
      </AuthProvider>
    </PageErrorBoundary>
  );
}
