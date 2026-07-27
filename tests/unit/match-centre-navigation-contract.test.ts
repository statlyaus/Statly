import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('live scoring and AFL match route ownership', () => {
  it('keeps Live Scoring primary and leaves AFL matches separate from league matchups', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    const dashboardQuickActions = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    const matchesPage = readRepoFile('src/app/(app)/matches/page.tsx');
    const liveScoringPage = readRepoFile('src/app/(app)/live-scoring/page.tsx');

    expect(navigation).toContain("name: 'Live Scoring'");
    expect(navigation).toContain("href: '/live-scoring'");
    expect(navigation).not.toContain("name: 'Match Centre'");
    expect(navigation).toContain("name: 'AFL Matches'");
    expect(navigation).toContain("href: '/matches'");
    expect(navigation).toContain("if (href === '/matches') return p.startsWith('/matches')");
    expect(navigation).toContain(
      "if (href === '/live-scoring') return p.startsWith('/live-scoring')"
    );

    expect(dashboardQuickActions).toContain("title: 'Live Scoring'");
    expect(dashboardQuickActions).toContain("href: '/live-scoring'");

    expect(matchesPage).toContain('RealTimeMatchCenter');
    expect(liveScoringPage).toContain('LiveScoringMatchup');
  });

  it('keeps one page title above the reusable live match section', () => {
    const matchesPage = readRepoFile('src/app/(app)/matches/page.tsx');
    const realTimeMatchCenter = readRepoFile('src/components/advanced/RealTimeMatchCenter.tsx');

    expect(matchesPage).toContain('<h1 className="text-2xl font-semibold">Match Centre</h1>');
    expect(realTimeMatchCenter).toContain(
      '<h2 className="text-3xl font-bold text-gray-900">Live Match Centre</h2>'
    );
    expect(realTimeMatchCenter).not.toContain('<h1');
  });

  it('contains the live-section tabs within the match centre on narrow screens', () => {
    const realTimeMatchCenter = readRepoFile('src/components/advanced/RealTimeMatchCenter.tsx');

    expect(realTimeMatchCenter).toContain('max-w-full');
    expect(realTimeMatchCenter).toContain('overflow-x-auto');
    expect(realTimeMatchCenter).toContain('overscroll-x-contain');
  });
});
