'use client';

import MainNavigation from './MainNavigation';
import ErrorBoundary from '../ErrorBoundary';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        <MainNavigation />
        <main>{children}</main>
      </div>
    </ErrorBoundary>
  );
}
