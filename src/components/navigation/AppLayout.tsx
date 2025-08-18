'use client';

import MainNavigation from './MainNavigation';
import { SectionErrorBoundary } from '../ui/ErrorBoundary';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <SectionErrorBoundary name="AppLayout">
      <div className="min-h-screen bg-gray-50">
        <MainNavigation />
        <main>{children}</main>
      </div>
    </SectionErrorBoundary>
  );
}
