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
import AflTradeMethodologyPage, {
  metadata as methodologyMetadata,
} from '../../src/app/(public)/draft/trades/methodology/page';
import { AFL_TRADE_METHODOLOGY_HREF } from '../../src/types/aflTradeIntelligence';

describe('public AFL draft trade routing', () => {
  it('states the homepage promise before the two primary hero destinations', () => {
    render(<HomePage />);

    const promise = screen.getByRole('heading', {
      level: 1,
      name: 'Run your AFL fantasy league with a clearer read.',
    });

    expect(promise).toBeVisible();
    expect(promise).not.toHaveClass('sr-only');
    expect(
      screen.getByText(
        'Drafts, rosters, trades, waivers, player research, and live scoring in one calm workspace.'
      )
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Fantasy Workspace' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: 'Explore AFL Archive' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
  });

  it('links the homepage public archive product card to the canonical AFL archive', () => {
    render(<HomePage />);

    const archiveLink = screen.getByRole('link', { name: /open afl archive/i });
    expect(archiveLink).toHaveAttribute('href', '/draft/trades');
    expect(archiveLink).not.toHaveAttribute('href', '/tradecentre');
  });

  it('keeps /tradecentre owned by the public AFL archive', () => {
    const tradeCentreRoute = readFileSync(
      join(process.cwd(), 'src/app/tradecentre/page.tsx'),
      'utf8'
    );

    expect(tradeCentreRoute).toContain("redirect('/draft/trades')");
    expect(tradeCentreRoute).not.toContain("redirect('/login?next=/tradecentre')");
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

  it('keeps the methodology page static, public, and canonically addressable', () => {
    const methodologyRoute = readRequiredFile('src/app/(public)/draft/trades/methodology/page.tsx');

    expect(methodologyMetadata.alternates?.canonical).toBe(AFL_TRADE_METHODOLOGY_HREF);
    expect(methodologyRoute).not.toContain('getDraftTrades');
    expect(methodologyRoute).not.toContain('getDraftTradeById');
    expect(methodologyRoute).not.toContain('createAflTradePrePublicationAvailability');

    render(
      <DraftLayout>
        <AflTradeMethodologyPage />
      </DraftLayout>
    );

    expect(screen.queryByTestId('auth-provider')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How Statly intends to explain AFL trade value' })
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to trade explorer' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
  });

  it('adds the static methodology route without displacing dynamic trade detail', () => {
    const methodologyRoute = readRequiredFile('src/app/(public)/draft/trades/methodology/page.tsx');
    const detailRoute = readRequiredFile('src/app/(public)/draft/trades/[tradeId]/page.tsx');

    expect(methodologyRoute).toContain('export default function AflTradeMethodologyPage');
    expect(detailRoute).toContain('export default async function DraftTradeDetailPage');
    expect(detailRoute).toContain("export const dynamic = 'force-dynamic'");
  });
});
