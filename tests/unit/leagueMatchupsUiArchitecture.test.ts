import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('league matchups UI architecture', () => {
  it('adds service-backed league matchups, lineup, standings, and scoring settings surfaces', () => {
    const leagueTabs = readRepoFile('src/components/league/LeagueTabs.tsx');
    const matchupsPanel = readRepoFile('src/components/league/matchups/LeagueMatchupsPanel.tsx');
    const lineupPanel = readRepoFile('src/components/league/matchups/LeagueLineupPanel.tsx');
    const standingsPanel = readRepoFile('src/components/league/matchups/LeagueStandingsPanel.tsx');
    const scoringSettings = readRepoFile('src/components/league/settings/ScoringSettingsPanel.tsx');

    expect(leagueTabs).toContain("'matchups'");
    expect(leagueTabs).toContain("'lineup'");
    expect(leagueTabs).toContain("'standings'");
    expect(leagueTabs).toContain('LeagueMatchupsPanel');
    expect(leagueTabs).toContain('LeagueLineupPanel');
    expect(leagueTabs).toContain('LeagueStandingsPanel');
    expect(leagueTabs).toContain('ScoringSettingsPanel');

    expect(matchupsPanel).toContain('/api/leagues/${leagueId}/matchups');
    expect(matchupsPanel).toContain('/recalculate');
    expect(matchupsPanel).toContain('No fixtures have been generated');
    expect(lineupPanel).toContain('/api/leagues/${leagueId}/lineups/${round}');
    expect(lineupPanel).toContain("method: 'PATCH'");
    expect(standingsPanel).toContain('Category record');
    expect(scoringSettings).toContain('H2H Each Category');
    expect(scoringSettings).toContain('H2H Most Categories');
    expect(scoringSettings).toContain('categoryDirections');
    expect(scoringSettings).toContain('lineupSlots');
  });
});
