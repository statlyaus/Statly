import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout, { isImmersiveAppPath } from '@/components/navigation/AppLayout';

const navigation = vi.hoisted(() => ({ pathname: '/drafts' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('@/components/navigation/MainNavigation', () => ({
  default: () => <header role="banner">Primary navigation</header>,
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

  it('keeps route-group ownership above page content', () => {
    const repoRoot = process.cwd();
    const appRouteLayout = readFileSync(join(repoRoot, 'src/app/(app)/layout.tsx'), 'utf8');
    const navigationSource = readFileSync(
      join(repoRoot, 'src/components/navigation/MainNavigation.tsx'),
      'utf8'
    );

    expect(appRouteLayout).toContain("import { AppLayout } from '@/components/navigation'");
    expect(appRouteLayout).toContain('<AppLayout>{children}</AppLayout>');
    expect(navigationSource).not.toContain("import { TeamProvider } from '@/contexts/TeamContext'");
    expect(navigationSource).not.toContain('<TeamProvider>');
  });
});
