import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('dashboard production recovery route contract', () => {
  it('keeps dashboard owned by the recovered top-level app route', () => {
    expect(existsSync(join(repoRoot, 'src/app/dashboard/page.tsx'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/app/dashboard/DashboardClient.tsx'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/app/(app)/dashboard/page.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'src/app/(app)/dashboard/ClientShell.tsx'))).toBe(false);

    const dashboardPage = readRepoFile('src/app/dashboard/page.tsx');
    expect(dashboardPage).toContain("import DashboardClient from './DashboardClient'");
    expect(dashboardPage).toContain("import { AuthProvider } from '@/AuthContext'");
    expect(dashboardPage).toContain('<DashboardClient />');

    const appLayout = readRepoFile('src/components/navigation/AppLayout.tsx');
    expect(appLayout).toContain("import MainNavigation from './MainNavigation'");
    expect(appLayout).toContain('<MainNavigation />');
  });

  it('keeps public AFL trade history ownership on /tradecentre', () => {
    const tradeCentreRoute = readRepoFile('src/app/tradecentre/page.tsx');
    expect(tradeCentreRoute).toContain("redirect('/draft/trades')");

    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    expect(navigation).not.toContain("href: '/tradecentre'");
    expect(navigation).not.toContain('href="/tradecentre"');
    expect(navigation).not.toContain("name: 'Trade Centre'");
  });

  it('removes old internal/demo nav labels from production navigation', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    expect(navigation).not.toContain('LM Tools');
    expect(navigation).not.toContain('Live Test');
    expect(navigation).not.toContain('Migration Demo');
    expect(navigation).toContain("name: 'Dashboard'");
    expect(navigation).toContain("name: 'Draft Hub'");
  });
});
