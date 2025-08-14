'use client';

import MainNavigation from './MainNavigation';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <MainNavigation />
      <main>{children}</main>
    </div>
  );
}
