'use client';

import type React from 'react';

import { SectionErrorBoundary } from '../ui/ErrorBoundary';
import MainNavigation from './MainNavigation';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  return (
    <SectionErrorBoundary name="AppLayout">
      <div className="min-h-screen bg-background">
        <MainNavigation />
        <main id="main-content">{children}</main>
      </div>
    </SectionErrorBoundary>
  );
}
