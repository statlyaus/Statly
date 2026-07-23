import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('tradecentre gateway route ownership', () => {
  it('keeps /tradecentre owned by the public AFL Draft & Trade Hub', () => {
    const page = readRepoFile('src/app/tradecentre/page.tsx');

    expect(page).toContain("import { redirect } from 'next/navigation'");
    expect(page).toContain("redirect('/draft/trades')");
    expect(page).not.toContain('/leagues/');
    expect(page).not.toContain('LeagueTradeProposalForm');
  });

  it('redirects the former standalone league route into the embedded Trade Centre', () => {
    const page = readRepoFile('src/app/(app)/leagues/[id]/trades/page.tsx');

    expect(page).toContain("new URLSearchParams({ tab: 'trades' })");
    expect(page).toContain('redirect(`/leagues/${encodeURIComponent(id)}?${target.toString()}`)');
    expect(page).toContain("target.set('playerId', query.playerId)");
    expect(page).toContain("target.set('ownerMemberId', query.ownerMemberId)");
    expect(page).not.toContain('LeagueTradeProposalForm');
    expect(page).not.toContain('/api/trades/list');
  });

  it('keeps fantasy trade mutations on the league-scoped canonical API', () => {
    const panel = readRepoFile('src/components/league/trades/LeagueTradeCentrePanel.tsx');
    const leagueTabs = readRepoFile('src/components/league/LeagueTabs.tsx');

    expect(panel).toContain('/api/leagues/${encodeURIComponent(leagueId)}/trades');
    expect(panel).not.toContain("postCommand('/api/trades");
    expect(leagueTabs).toContain(
      "import { LeagueTradeCentrePanel } from './trades/LeagueTradeCentrePanel'"
    );
    expect(leagueTabs).not.toContain('LeagueTradeProposalForm');
  });
});
