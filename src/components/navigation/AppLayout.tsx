'use client';

import React from 'react';
import MainNavigation from './MainNavigation';
import { SectionErrorBoundary } from '../ui/ErrorBoundary';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <SectionErrorBoundary name="AppLayout">
      <div className="min-h-screen bg-gray-50">
        {/* Skip to content for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] bg-white text-blue-700 border border-blue-300 rounded px-3 py-2 shadow"
        >
          Skip to content
        </a>
        <MainNavigation />
        <main id="main-content">{children}</main>
      </div>
    </SectionErrorBoundary>
  );
}
