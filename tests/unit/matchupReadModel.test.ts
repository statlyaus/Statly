import { describe, expect, it } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toMatchupStatusFromRoundStatus } from '@/server/leagues/matchupReadModel';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('matchupReadModel helpers', () => {
  it('derives matchup status from live/final round status', () => {
    expect(toMatchupStatusFromRoundStatus({ anyLive: true, allFinal: false })).toBe('LIVE');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: true })).toBe('FINAL');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: false })).toBe('SCHEDULED');
  });

  it('keeps Match Centre reads fixture-backed and category-score normalized', () => {
    const readModel = readRepoFile('src/server/leagues/matchupReadModel.ts');

    expect(REAL_DATA_NINE_CATEGORY_PRESET).toHaveLength(9);
    expect(readModel).toContain('LeagueMatchupCategoryRow');
    expect(readModel).toContain('LeagueMatchupPlayerContribution');
    expect(readModel).toContain('availableRounds');
    expect(readModel).toContain('buildCategoryRows');
    expect(readModel).toContain('buildPlayerContributions');
    expect(readModel).toContain('FANTASY_CATEGORIES');
    expect(readModel).toContain('userId: string');
    expect(readModel).toContain('viewerMember');
    expect(readModel).toContain('viewerMatchupWhere');
    expect(readModel).toContain("lineupPlayer.slot !== 'BENCH'");
    expect(readModel).toContain("settings.fixtureGenerationMode === 'AUTOMATIC'");
    expect(readModel).toContain('await generateLeagueFixtures({ leagueId })');
    expect(readModel).toContain('categoryRows: buildCategoryRows');
  });
});
