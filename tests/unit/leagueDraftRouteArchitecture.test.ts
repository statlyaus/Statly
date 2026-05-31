import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league draft route architecture', () => {
  it('requires league membership before draft state reads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/draft/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain("import { verifyLeagueMembership } from '@/lib/leagueMembership'");
    expect(source).toContain('authorizeLeagueDraftRead(req, leagueId)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const membership = await verifyLeagueMembership(leagueId, userId);');
    expect(source).toContain('!membership.isMember');
    expect(source.indexOf('authorizeLeagueDraftRead(req, leagueId)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
  });
});
