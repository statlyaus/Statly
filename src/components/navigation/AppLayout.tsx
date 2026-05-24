'use client';

import type React from 'react';

import { SectionErrorBoundary } from '../ui/ErrorBoundary';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  return (
    <SectionErrorBoundary name="AppLayout">
      <div className="min-h-screen bg-background">
        {/* Note: MainNavigation is rendered in root layout.tsx, not here to avoid duplication */}
        <main id="main-content">{children}</main>
      </div>
    </SectionErrorBoundary>
  );
}
