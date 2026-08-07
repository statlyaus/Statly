import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const navigation = vi.hoisted(() => ({ pathname: '/draft/trades' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

import PublicRouteLayout from '../../src/app/(public)/layout';
import HomePage from '../../src/app/(public)/page';
import DraftLayout from '../../src/app/(public)/draft/layout';
import AflTradeMethodologyPage, {
  metadata as methodologyMetadata,
} from '../../src/app/(public)/draft/trades/methodology/page';

describe('public AFL draft trade routing', () => {
  beforeEach(() => {
    navigation.pathname = '/draft/trades';
  });

  it('puts the public archive and unpublished outcome status in the homepage hero', () => {
    render(<HomePage />);

    const promise = screen.getByRole('heading', {
      level: 1,
      name: 'Explore AFL draft trades. Run your fantasy league.',
    });

    expect(promise).toBeVisible();
    expect(promise).not.toHaveClass('sr-only');
    expect(
      screen.getByText(/The public AFL archive is separate from Statly Fantasy/)
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Explore AFL trade archive' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
    expect(screen.getByRole('link', { name: 'Open Fantasy Workspace' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByText('Numerical outcomes not published')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Outcome publication status' })).toHaveAttribute(
      'href',
      '/draft/outcomes'
    );
  });

  it('places the public Outcomes product before Fantasy with separate canonical destinations', () => {
    render(<HomePage />);

    const outcomesHeading = screen.getByRole('heading', {
      level: 3,
      name: 'AFL Draft & Trade Outcomes',
    });
    const fantasyHeading = screen.getByRole('heading', { level: 3, name: 'Statly Fantasy' });
    expect(
      outcomesHeading.compareDocumentPosition(fantasyHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(screen.getByText(/are not owned by Statly users or fantasy teams/)).toBeVisible();

    const archiveLink = screen.getByRole('link', { name: /explore trade archive/i });
    expect(archiveLink).toHaveAttribute('href', '/draft/trades');
    expect(archiveLink).not.toHaveAttribute('href', '/tradecentre');
    expect(screen.getByRole('link', { name: 'View outcome status' })).toHaveAttribute(
      'href',
      '/draft/outcomes'
    );
  });

  it('provides one public main landmark, skip navigation, and an active Outcomes destination', () => {
    render(
      <PublicRouteLayout>
        <HomePage />
      </PublicRouteLayout>
    );

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content'
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary' });
    const outcomesLink = within(primaryNavigation).getByRole('link', {
      name: 'AFL Draft & Trade Outcomes',
    });
    expect(outcomesLink).toHaveAttribute('href', '/draft/trades');
    expect(outcomesLink).toHaveAttribute('aria-current', 'page');
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

  it('keeps the draft hub status and Fantasy actions pointed at their separate routes', () => {
    render(
      <DraftLayout>
        <main>Draft child</main>
      </DraftLayout>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'AFL Draft & Trade Outcomes' })
    ).toBeVisible();
    expect(
      screen.getByText(/Checked numerical outcome releases are not yet published/)
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Outcome publication status' })).toHaveAttribute(
      'href',
      '/draft/outcomes'
    );
    expect(screen.getByRole('link', { name: /open statly fantasy/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: /trade archive/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('marks the outcome status destination independently from archive and methodology routes', () => {
    navigation.pathname = '/draft/outcomes';
    render(
      <DraftLayout>
        <div>Outcome status child</div>
      </DraftLayout>
    );

    const hubNavigation = screen.getByRole('navigation', {
      name: 'AFL Draft and Trade Outcomes sections',
    });
    expect(within(hubNavigation).getByRole('link', { name: /outcomes/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(hubNavigation).getByRole('link', { name: /trade archive/i })).not.toHaveAttribute(
      'aria-current'
    );
    expect(
      within(hubNavigation).getByRole('link', { name: /methodology & status/i })
    ).not.toHaveAttribute('aria-current');
  });

  it('keeps the methodology page static and public without inventing a canonical origin', () => {
    navigation.pathname = '/draft/trades/methodology';
    const methodologyRoute = readRequiredFile('src/app/(public)/draft/trades/methodology/page.tsx');

    expect(methodologyMetadata.alternates?.canonical).toBeUndefined();
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
    expect(screen.getByRole('link', { name: /methodology & status/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: /trade archive/i })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('adds the static methodology route without displacing dynamic trade detail', () => {
    const methodologyRoute = readRequiredFile('src/app/(public)/draft/trades/methodology/page.tsx');
    const detailRoute = readRequiredFile('src/app/(public)/draft/trades/[tradeId]/page.tsx');

    expect(methodologyRoute).toContain('export default function AflTradeMethodologyPage');
    expect(detailRoute).toContain('export default async function DraftTradeDetailPage');
    expect(detailRoute).toContain("export const dynamic = 'force-dynamic'");
    expect(detailRoute).toContain('getDevelopmentWorkbookTradeGradeEvidence');
    expect(detailRoute).toContain('developmentGradeEvidence={developmentGradeEvidence}');
  });
});
