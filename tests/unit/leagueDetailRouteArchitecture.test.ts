import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league detail route architecture', () => {
  it('requires league membership before private league detail reads', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/route.ts'),
      'utf8'
    );
    const pageSource = readFileSync(join(process.cwd(), 'src/app/leagues/[id]/page.tsx'), 'utf8');

    expect(routeSource).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(routeSource).toContain("from '@/lib/leagueMembership'");
    expect(routeSource).toContain('verifyLeagueMembership');
    expect(routeSource).toContain('authorizeLeagueDetailRead(req, leagueId)');
    expect(routeSource).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(routeSource).toContain(
      'const membership = await verifyLeagueMembership(leagueId, userId);'
    );
    expect(routeSource).toContain('!membership.isMember');
    expect(routeSource).toContain("'Cache-Control': 'private, no-store'");
    expect(routeSource).not.toContain("'Cache-Control': 'public, max-age=0, s-maxage=120");
    expect(routeSource.indexOf('authorizeLeagueDetailRead(req, leagueId)')).toBeLessThan(
      routeSource.indexOf('prisma.league.findUnique')
    );
    expect(routeSource.indexOf('authorizeLeagueDetailRead(req, leagueId)')).toBeLessThan(
      routeSource.indexOf("adminDb.collection('leagues').doc(leagueId)")
    );

    expect(pageSource).toContain("import { cookies } from 'next/headers'");
    expect(pageSource).toContain('headers: { cookie: cookieStore.toString() }');
  });
});
