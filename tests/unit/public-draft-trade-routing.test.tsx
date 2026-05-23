import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

function readRequiredFile(relativePath: string): string {
  const absolutePath = join(process.cwd(), relativePath);
  expect(existsSync(absolutePath), `${relativePath} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'font-inter' }),
}));

vi.mock('@/components/ClientSentryWrapper', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/PerformanceMonitor', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/ErrorBoundary', () => ({
  PageErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/draft/trades',
}));

import HomePage from '../../src/app/(public)/page';
import DraftLayout from '../../src/app/(public)/draft/layout';

type NextRedirect = {
  source: string;
  destination: string;
  permanent?: boolean;
};

type NextConfigWithRedirects = {
  redirects?: () => NextRedirect[] | Promise<NextRedirect[]>;
};

describe('public AFL draft trade routing', () => {
  it('links the homepage Draft & Trade Hub product card to the canonical public hub', () => {
    render(<HomePage />);

    const tradeHubLink = screen.getByRole('link', { name: /open trade hub/i });
    expect(tradeHubLink).toHaveAttribute('href', '/draft/trades');
    expect(tradeHubLink).not.toHaveAttribute('href', '/tradecentre');
  });

  it('keeps the legacy /tradecentre URL as a request-level redirect to /draft/trades', async () => {
    const { default: nextConfig } = (await import(
      '../../next.config.mjs'
    )) as { default: NextConfigWithRedirects };
    const redirects = await nextConfig.redirects?.();
    const tradeCentreRoute = readFileSync(
      join(process.cwd(), 'src/app/tradecentre/page.tsx'),
      'utf8'
    );

    expect(redirects).toContainEqual({
      source: '/tradecentre',
      destination: '/draft/trades',
      permanent: false,
    });
    expect({
      usesClientDirective: /['"]use client['"]/.test(tradeCentreRoute),
      importsNextRedirect: /from\s+['"]next\/navigation['"]/.test(tradeCentreRoute),
      redirectsToCanonicalHub: /redirect\(\s*['"]\/draft\/trades['"]\s*\)/.test(
        tradeCentreRoute
      ),
    }).toEqual({
      usesClientDirective: false,
      importsNextRedirect: true,
      redirectsToCanonicalHub: true,
    });
  });

  it('keeps AuthProvider out of the root layout and inside the app/auth route groups', () => {
    const rootLayout = readRequiredFile('src/app/layout.tsx');
    const appLayout = readRequiredFile('src/app/(app)/layout.tsx');
    const authLayout = readRequiredFile('src/app/(auth)/layout.tsx');

    expect(rootLayout).not.toContain('AuthProvider');
    expect(appLayout).toContain('AuthProvider');
    expect(authLayout).toContain('AuthProvider');
  });

  it('keeps the draft hub fantasy return CTA pointed at an existing route', () => {
    render(
      <DraftLayout>
        <main>Draft child</main>
      </DraftLayout>
    );

    expect(screen.getByRole('link', { name: /return to fantasy/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });
});
