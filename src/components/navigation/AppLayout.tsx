'use client';

import { createContext, useContext } from 'react';
import type React from 'react';
import { usePathname } from 'next/navigation';

import { TeamProvider } from '@/contexts/TeamContext';

import { SectionErrorBoundary } from '../ui/ErrorBoundary';
import MainNavigation from './MainNavigation';

interface AppLayoutProps {
  children: React.ReactNode;
  mode?: 'auto' | 'shell';
}

const AppLayoutContext = createContext(false);
const draftHubRoutes = new Set(['create', 'history', 'settings']);

export function isImmersiveAppPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);

  return segments.length === 2 && segments[0] === 'drafts' && !draftHubRoutes.has(segments[1]);
}

export default function AppLayout({ children, mode = 'auto' }: AppLayoutProps): React.ReactElement {
  const isNested = useContext(AppLayoutContext);
  const pathname = usePathname();
  const shell = (
    <div data-app-shell className="min-h-screen w-full min-w-0 bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MainNavigation />
      <div id="main-content" role="main" tabIndex={-1} className="w-full min-w-0 outline-none">
        {children}
      </div>
    </div>
  );

  if (isNested) {
    return mode === 'shell' ? shell : <>{children}</>;
  }

  const content = mode === 'shell' || !isImmersiveAppPath(pathname ?? '') ? shell : children;

  return (
    <SectionErrorBoundary name="AppLayout">
      <TeamProvider>
        <AppLayoutContext.Provider value>{content}</AppLayoutContext.Provider>
      </TeamProvider>
    </SectionErrorBoundary>
  );
}
