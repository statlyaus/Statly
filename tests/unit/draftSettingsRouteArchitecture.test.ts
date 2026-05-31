import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league draft-settings route architecture', () => {
  it('authorizes members for reads and managers for writes before data access', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/draft-settings/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership'"
    );
    expect(source).toContain('authorizeDraftSettingsRead(request, id)');
    expect(source).toContain('authorizeDraftSettingsWrite(request, id)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const membership = await getLeagueMembership(leagueId, userId);');
    expect(source).toContain('!isLeagueManagerRole(membership.data?.role)');
    expect(source.indexOf('authorizeDraftSettingsWrite(request, id)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
    expect(source.indexOf('authorizeDraftSettingsRead(request, id)')).toBeLessThan(
      source.lastIndexOf('prisma.league.findUnique')
    );
  });
});
