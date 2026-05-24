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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <MainNavigation />
        <main id="main-content">{children}</main>
      </div>
    </SectionErrorBoundary>
  );
}
