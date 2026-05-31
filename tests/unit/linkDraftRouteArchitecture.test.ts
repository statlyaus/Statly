import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league link-draft route architecture', () => {
  it('requires a league manager before mutating league draft links', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/link-draft/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership'"
    );
    expect(source).toContain('authorizeLeagueDraftLink(request, leagueId)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const membership = await getLeagueMembership(leagueId, userId);');
    expect(source).toContain('isLeagueManagerRole(membership.data?.role)');
    expect(source.indexOf('authorizeLeagueDraftLink(request, leagueId)')).toBeLessThan(
      source.indexOf("adminDb.collection('leagues').doc(leagueId)")
    );
  });
});
