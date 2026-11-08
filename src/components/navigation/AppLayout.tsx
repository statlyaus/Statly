'use client';

import { createContext, useContext } from 'react';
import type React from 'react';
import { usePathname } from 'next/navigation';

import { SectionErrorBoundary } from '../ui/ErrorBoundary';
import MainNavigation from './MainNavigation';

interface AppLayoutProps {
  children: React.ReactNode;
  mode?: 'auto' | 'shell';
  /** Whether the caller may use fantasy basketball (`canUseBasketball`); a nested layout inherits it. */
  showBasketball?: boolean;
}

// Set by the outermost AppLayout; a nested one (the draft room's shell) reads it.
const AppLayoutContext = createContext<{ showBasketball: boolean } | null>(null);
const draftHubRoutes = new Set(['create', 'history', 'settings']);

export function isImmersiveAppPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);

  return segments.length === 2 && segments[0] === 'drafts' && !draftHubRoutes.has(segments[1]);
}

export default function AppLayout({
  children,
  mode = 'auto',
  showBasketball,
}: AppLayoutProps): React.ReactNode {
  const outer = useContext(AppLayoutContext);
  const isNested = outer !== null;
  const basketballVisible = showBasketball ?? outer?.showBasketball ?? false;
  const pathname = usePathname();
  const shell = (
    <div data-app-shell className="min-h-screen w-full min-w-0 bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MainNavigation showBasketball={basketballVisible} />
      <main id="main-content" tabIndex={-1} className="w-full min-w-0 outline-none">
        {children}
      </main>
    </div>
  );

  if (isNested) {
    return mode === 'shell' ? shell : children;
  }

  const content = mode === 'shell' || !isImmersiveAppPath(pathname ?? '') ? shell : children;

  return (
    <SectionErrorBoundary name="AppLayout">
      <AppLayoutContext.Provider value={{ showBasketball: basketballVisible }}>
        {content}
      </AppLayoutContext.Provider>
    </SectionErrorBoundary>
  );
}
