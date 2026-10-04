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
    const lineupPanel = readRepoFile('src/components/league/myteam/LeagueMyTeamPanel.tsx');
    const standingsPanel = readRepoFile('src/components/league/matchups/LeagueStandingsPanel.tsx');
    const settingsPanels = readRepoFile('src/components/league/LeagueSettingsPanels.tsx');
    const scoringSettings = readRepoFile('src/components/league/settings/ScoringSettingsPanel.tsx');

    expect(leagueTabs).toContain("'matchups'");
    expect(leagueTabs).toContain("'lineup'");
    expect(leagueTabs).toContain("'standings'");
    expect(leagueTabs).toContain('LeagueMatchupsPanel');
    expect(leagueTabs).toContain('LeagueMyTeamPanel');
    expect(leagueTabs).toContain('LeagueStandingsPanel');
    expect(leagueTabs).toContain("import('./LeagueSettingsPanels')");
    expect(settingsPanels).toContain('ScoringSettingsPanel');

    expect(matchupsPanel).toContain('/api/leagues/${leagueId}/matchups');
    expect(matchupsPanel).not.toContain('Generate fixtures');
    expect(matchupsPanel).toContain('?round=');
    expect(matchupsPanel).toContain('Weekly head-to-head Match Centre');
    expect(matchupsPanel).toContain('categoryRows');
    expect(matchupsPanel).toContain('MatchupHeadToHeadCard');
    expect(matchupsPanel).toContain('CategoryTotalsGrid');
    expect(matchupsPanel).toContain('TeamBoxScoreTable');
    expect(matchupsPanel).toContain('Player stats · Round');
    expect(matchupsPanel).toContain('Match-up totals by scoring category');
    expect(matchupsPanel).toContain('table-fixed');
    // Screen-reader-only cell labels are absolutely positioned; a positioned scroll wrapper keeps
    // them from widening the page on phones.
    expect(matchupsPanel.match(/relative overflow-x-auto/g)).toHaveLength(2);
    expect(matchupsPanel).toContain('Team total');
    expect(matchupsPanel).toContain('box score');
    expect(matchupsPanel).not.toContain('Statly Z');
    expect(matchupsPanel).toContain('Round');
    expect(matchupsPanel).not.toContain('/recalculate');
    expect(matchupsPanel).not.toContain('Finalize');
    expect(matchupsPanel).not.toContain('Recalculate');
    expect(matchupsPanel).toContain('No weekly matchups are available yet');
    expect(matchupsPanel).toContain('Set your lineup');
    expect(matchupsPanel).toContain('Open the My Team tab');
    expect(lineupPanel).toContain('/lineups/${round}');
    expect(lineupPanel).toContain('/lineups/${requestedRound}');
    expect(lineupPanel).toContain('rosterPlayers');
    expect(lineupPanel).toContain('lineupSlots');
    expect(lineupPanel).toContain('placePlayer');
    expect(lineupPanel).toContain('removeFromSpot');
    expect(lineupPanel).toContain('autoFillLineup');
    expect(lineupPanel).not.toContain('canAssignToSlot');
    expect(lineupPanel).not.toContain('xl:grid-cols-[300px_minmax(0,1fr)]');
    expect(lineupPanel).toContain("method: 'PATCH'");
    expect(standingsPanel).toContain('/standings');
    expect(standingsPanel).toContain('StandingsLadder');
    expect(scoringSettings).toContain('H2H Each Category');
    expect(scoringSettings).toContain('H2H Most Categories');
    expect(scoringSettings).toContain('categoryDirections');
    expect(scoringSettings).toContain('lineupSlots');
  });
});
