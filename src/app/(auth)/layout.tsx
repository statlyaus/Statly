import type { ReactNode } from 'react';

import { AuthProvider } from '@/AuthContext';
import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <PageErrorBoundary name="AuthLayout">
      <AuthProvider>{children}</AuthProvider>
    </PageErrorBoundary>
  );
}
