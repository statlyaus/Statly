import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('match centre navigation ownership', () => {
  it('uses /matches as Match Centre and keeps /live-scoring separate', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    const dashboardQuickActions = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    const matchesPage = readRepoFile('src/app/(app)/matches/page.tsx');
    const liveScoringPage = readRepoFile('src/app/(app)/live-scoring/page.tsx');

    expect(navigation).toContain("name: 'Match Centre'");
    expect(navigation).toContain("href: '/matches'");
    expect(navigation).toContain("name: 'Live Scoring'");
    expect(navigation).toContain("href: '/live-scoring'");
    expect(navigation).toContain("if (href === '/matches') return p.startsWith('/matches')");
    expect(navigation).toContain("if (href === '/live-scoring') return p.startsWith('/live-scoring')");

    expect(dashboardQuickActions).toContain("title: 'Match Centre'");
    expect(dashboardQuickActions).toContain("href: '/matches'");

    expect(matchesPage).toContain('RealTimeMatchCenter');
    expect(matchesPage).toContain('Match Centre');
    expect(liveScoringPage).toContain('LiveScoringMatchup');
  });
});
