import type { ReactNode } from 'react';

import { AuthProvider } from '@/AuthContext';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function AuthRouteLayout({ children }: { readonly children: ReactNode }) {
  return (
    <PageErrorBoundary name="AuthRouteLayout">
      <AuthProvider>{children}</AuthProvider>
    </PageErrorBoundary>
  );
}
