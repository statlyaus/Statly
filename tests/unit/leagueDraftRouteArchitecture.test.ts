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
    expect(source).toContain('getLeagueMembershipAccess');
    expect(source).not.toContain('verifyLeagueMembership(');
    expect(source).toContain('authorizeLeagueDraftRead(req, leagueId)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const access = await getLeagueMembershipAccess(leagueId, userId);');
    expect(source).toContain('!access.isMember');
    expect(source).toContain('canManage: access.canManage');
    expect(source).toContain('memberCount');
    expect(source).toContain('maxTeams');
    expect(source.indexOf('authorizeLeagueDraftRead(req, leagueId)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
  });

  it('keeps draft creation league-scoped without hidden link reconciliation', () => {
    const draftRouteSource = readFileSync(join(process.cwd(), 'src/app/api/drafts/route.ts'), 'utf8');
    const draftManagerSource = readFileSync(
      join(process.cwd(), 'src/components/league/DraftManager.tsx'),
      'utf8'
    );

    expect(draftRouteSource).toContain('leagueId: result.league.id');
    expect(draftRouteSource).toContain('league: {');
    expect(draftRouteSource).toContain('id: result.league.id');
    expect(draftManagerSource).not.toContain('link-draft');
    expect(draftManagerSource).toContain('createdDraft.leagueId === league.id');
    expect(draftManagerSource).toContain('createdDraft.league?.id === league.id');
  });

  it('allows normalized manager roles to use league admin settings', () => {
    const leagueTabsSource = readFileSync(
      join(process.cwd(), 'src/components/league/LeagueTabs.tsx'),
      'utf8'
    );

    expect(leagueTabsSource).toContain(
      "const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'manager';"
    );
    expect(leagueTabsSource).not.toContain(
      "members.find((m) => m.userId === currentUserId)?.role === 'owner'"
    );
  });
});
