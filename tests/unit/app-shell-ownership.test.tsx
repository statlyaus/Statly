import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppRouteLayout from '@/app/(app)/layout';
import AppLayout, { isImmersiveAppPath } from '@/components/navigation/AppLayout';

const navigation = vi.hoisted(() => ({ pathname: '/drafts' }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => navigation.pathname,
}));

vi.mock('@/components/navigation/MainNavigation', () => ({
  default: () => <header role="banner">Primary navigation</header>,
}));

vi.mock('@/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: async () => 'test-user',
}));

vi.mock('@/components/league/social/LeagueSocialAppProvider', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="league-social-provider">{children}</div>
  ),
}));

vi.mock('@/components/PerformanceMonitor', () => ({
  default: () => <div data-testid="performance-monitor" />,
}));

vi.mock('@/components/ui/ErrorBoundary', () => ({
  PageErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  SectionErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/TeamContext', () => ({
  TeamProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="team-provider">{children}</div>
  ),
}));

describe('app shell ownership', () => {
  beforeEach(() => {
    navigation.pathname = '/drafts';
  });

  it('renders one shell and one team provider when legacy wrappers are nested', () => {
    render(
      <AppLayout>
        <AppLayout>
          <main>Draft center</main>
        </AppLayout>
      </AppLayout>
    );

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByText('Skip to content')).toHaveLength(1);
    expect(document.querySelectorAll('[data-app-shell]')).toHaveLength(1);
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
    expect(screen.getAllByTestId('team-provider')).toHaveLength(1);
  });

  it('keeps a live draft room immersive', () => {
    navigation.pathname = '/drafts/draft-123';

    render(
      <AppLayout>
        <main>Live draft room</main>
      </AppLayout>
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByText('Skip to content')).not.toBeInTheDocument();
    expect(document.querySelector('[data-app-shell]')).toBeNull();
    expect(screen.getAllByTestId('team-provider')).toHaveLength(1);
  });

  it('allows draft access states to request the standard shell', () => {
    navigation.pathname = '/drafts/draft-123';

    render(
      <AppLayout>
        <AppLayout mode="shell">
          <main>Authentication required</main>
        </AppLayout>
      </AppLayout>
    );

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(document.querySelectorAll('[data-app-shell]')).toHaveLength(1);
    expect(screen.getAllByTestId('team-provider')).toHaveLength(1);
  });

  it('classifies only draft detail routes as immersive', () => {
    expect(isImmersiveAppPath('/drafts/draft-123')).toBe(true);
    expect(isImmersiveAppPath('/drafts/create')).toBe(false);
    expect(isImmersiveAppPath('/drafts/history')).toBe(false);
    expect(isImmersiveAppPath('/drafts/history/draft-123')).toBe(false);
    expect(isImmersiveAppPath('/drafts/settings')).toBe(false);
    expect(isImmersiveAppPath('/drafts')).toBe(false);
  });

  it('keeps route-group ownership above page content', async () => {
    const layout = await AppRouteLayout({
      children: <div>Protected route content</div>,
    });

    render(layout);

    expect(document.querySelectorAll('[data-app-shell]')).toHaveLength(1);
    expect(screen.getAllByTestId('team-provider')).toHaveLength(1);
    expect(screen.getAllByTestId('auth-provider')).toHaveLength(1);
    expect(screen.getAllByTestId('league-social-provider')).toHaveLength(1);
    expect(screen.getAllByTestId('performance-monitor')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('Protected route content');
  });
});
