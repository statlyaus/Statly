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
    expect(appLayout).toContain('href="#main-content"');
    expect(appLayout).toContain('Skip to content');
  });

  it('keeps public AFL archive separate from fantasy Trade Centre', () => {
    const tradeCentreRoute = readRepoFile('src/app/tradecentre/page.tsx');
    expect(tradeCentreRoute).not.toContain("redirect('/draft/trades')");
    expect(tradeCentreRoute).toContain("redirect('/login?next=/tradecentre')");
    expect(tradeCentreRoute).toContain('leagueMember.findFirst');
    expect(tradeCentreRoute).toContain("redirect(`/leagues/${membership.leagueId}/trades`)");

    const publicHome = readRepoFile('src/app/(public)/page.tsx');
    expect(publicHome).toContain('AFL Draft & Trade Archive');
    expect(publicHome).toContain("href: '/draft/trades'");
    expect(publicHome).not.toContain('Draft & Trade Hub');

    const publicLayout = readRepoFile('src/app/(public)/layout.tsx');
    expect(publicLayout).toContain('AFL Archive');
    expect(publicLayout).not.toContain('Draft & Trade Hub');

    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    expect(navigation).not.toContain("href: '/tradecentre'");
    expect(navigation).not.toContain('/tradecentre');
    expect(navigation).toContain("name: 'Waivers & Trades'");

    const quickActionsModule = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    expect(quickActionsModule).not.toContain('/tradecentre');

    const rostersPage = readRepoFile('src/app/(app)/rosters/page.tsx');
    expect(rostersPage).not.toContain('/tradecentre');
  });

  it('removes old internal/demo nav labels from production navigation', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    expect(navigation).not.toContain('LM Tools');
    expect(navigation).not.toContain('Live Test');
    expect(navigation).not.toContain('Migration Demo');
    expect(navigation).toContain("name: 'Dashboard'");
    expect(navigation).toContain("name: 'Draft Hub'");
  });

  it('consolidates the league directory into the dashboard route', () => {
    const leaguesPage = readRepoFile('src/app/(app)/leagues/page.tsx');
    const dashboard = readRepoFile('src/components/ModularDashboard.tsx');
    const leagueManagement = readRepoFile('src/components/dashboard/LeagueManagementModule.tsx');
    const quickActions = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    const recentActivity = readRepoFile('src/components/dashboard/RecentActivityModule.tsx');
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    const nextConfig = readRepoFile('next.config.mjs');

    expect(leaguesPage).toContain("import { redirect } from 'next/navigation'");
    expect(leaguesPage).toContain("redirect('/dashboard')");
    expect(nextConfig).toContain("source: '/leagues'");
    expect(nextConfig).toContain("destination: '/dashboard'");

    expect(dashboard).toContain("href=\"/dashboard#leagues\"");
    expect(dashboard).toContain('Open League Hub');
    expect(dashboard).toContain('const username =');
    expect(dashboard).toContain('@{username}');
    expect(dashboard).toContain('title="My Leagues"');
    expect(dashboard).toContain('Active Leagues');
    expect(dashboard).toContain('Attention Now');
    expect(dashboard).not.toContain('Welcome back');
    expect(dashboard).not.toContain('Track your leagues');
    expect(dashboard).not.toContain('Performance Snapshot');
    expect(dashboard).not.toContain('Account overview');
    expect(dashboard).not.toContain('Market Intel');
    expect(dashboard).not.toContain('Season scoring leaders');
    expect(leagueManagement).toContain('id="leagues"');
    expect(leagueManagement).toContain('leagues.map((league, index)');
    expect(leagueManagement).not.toContain('leagues.slice(0, 4)');
    expect(leagueManagement).not.toContain('href="/leagues"');

    expect(quickActions).toContain("href: '/dashboard#leagues'");
    expect(recentActivity).toContain('href="/dashboard#leagues"');
    expect(navigation).not.toContain("name: 'Leagues'");
    expect(navigation).not.toContain("href: '/dashboard#leagues'");
  });
});
