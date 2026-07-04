import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league detail route architecture', () => {
  it('keeps league detail authorization and reads in a shared server boundary', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/route.ts'),
      'utf8'
    );
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/page.tsx'),
      'utf8'
    );
    const clientSource = readFileSync(
      join(process.cwd(), 'src/app/(app)/leagues/[id]/LeaguePageClient.tsx'),
      'utf8'
    );
    const loaderSource = readFileSync(
      join(process.cwd(), 'src/server/leagues/leagueDetail.ts'),
      'utf8'
    );

    expect(routeSource).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(routeSource).toContain(
      "import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail'"
    );
    expect(routeSource).toContain('const userId = await getAuthenticatedUserId(req);');
    expect(routeSource).toContain(
      'const result = await loadAuthorizedLeagueDetail(leagueId, userId);'
    );
    expect(routeSource).toContain("'Cache-Control': 'private, no-store'");
    expect(routeSource).not.toContain("'Cache-Control': 'public, max-age=0, s-maxage=120");
    expect(routeSource).not.toContain('prisma.league.findUnique');
    expect(routeSource).not.toContain("adminDb.collection('leagues').doc(leagueId)");

    expect(pageSource).toContain("from 'next/headers'");
    expect(pageSource).toContain('cookies()');
    expect(pageSource).toContain('headers()');
    expect(pageSource).toContain(
      "import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail'"
    );
    expect(pageSource).toContain('const result = await loadAuthorizedLeagueDetail(id, userId);');
    expect(pageSource).not.toContain('fetch(');
    expect(pageSource).not.toContain('/api/leagues');
    expect(pageSource).not.toContain('APP_BASE_URL');
    expect(pageSource).not.toContain('NEXT_PUBLIC_APP_URL');

    expect(clientSource).toContain("import LeagueTabs from '@/components/league/LeagueTabs'");
    expect(clientSource).toContain('<LeagueTabs');
    expect(clientSource).not.toContain('OnboardingChecklist');
    expect(clientSource).not.toContain('Debug Info');
    expect(clientSource).not.toContain(
      "import LeagueOverview from '@/components/league/LeagueOverview'"
    );
    expect(
      existsSync(join(process.cwd(), 'src/app/(app)/leagues/[id]/OnboardingChecklist.tsx'))
    ).toBe(false);

    expect(loaderSource).toContain("import 'server-only'");
    expect(loaderSource).toContain("from '@/lib/leagueMembership'");
    expect(loaderSource).toContain("from '@/server/leagues/membership'");
    expect(loaderSource).toContain('getLeagueMembershipAccess');
    expect(loaderSource).toContain('!access.isMember');
    expect(loaderSource).not.toContain('verifyLeagueMembership');
    expect(loaderSource).toContain('prisma.league.findUnique');
    expect(loaderSource).toContain("adminDb.collection('leagues').doc(leagueId)");
    expect(loaderSource).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(loaderSource).toContain('normalizeLeagueCategories(prismaLeague.categoriesJson)');
    expect(loaderSource).toContain('selected.length === parsed.length');
    expect(loaderSource).not.toContain(
      "categories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s']"
    );
  });

  it('keeps the tabbed league overview free of legacy placeholder sections', () => {
    const tabsSource = readFileSync(
      join(process.cwd(), 'src/components/league/LeagueTabs.tsx'),
      'utf8'
    );

    expect(tabsSource).not.toContain(
      "import LeagueOverview from '@/components/league/LeagueOverview'"
    );
    expect(tabsSource).not.toContain('Trade interface coming soon');
    expect(tabsSource).not.toContain('Waiver wire interface coming soon');
    expect(tabsSource).not.toContain('Thunder Bolts');
    expect(tabsSource).not.toContain('4-3');
    expect(tabsSource).not.toContain('823.1');
    expect(tabsSource).not.toContain('badge: 2');
    expect(existsSync(join(process.cwd(), 'src/components/league/LeagueOverview.tsx'))).toBe(false);
    expect(tabsSource).toContain('League command center');
    expect(tabsSource).toContain('Draft setup status');
  });
});
