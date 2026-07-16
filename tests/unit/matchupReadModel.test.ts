import { describe, expect, it } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveCurrentCompetitionRound,
  toMatchupStatusFromRoundStatus,
} from '@/server/leagues/matchupReadModel';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('matchupReadModel helpers', () => {
  it('derives matchup status from live/final round status', () => {
    expect(toMatchupStatusFromRoundStatus({ anyLive: true, allFinal: false })).toBe('LIVE');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: true })).toBe('FINAL');
    expect(toMatchupStatusFromRoundStatus({ anyLive: false, allFinal: false })).toBe('SCHEDULED');
  });

  it('chooses the latest eligible started round when prior rounds have no end time', () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const rounds = [
      {
        round: 1,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-01T12:00:00.000Z'),
        endsAt: null,
      },
      {
        round: 2,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-10T12:00:00.000Z'),
        endsAt: null,
      },
      {
        round: 3,
        status: 'SCHEDULED',
        startsAt: new Date('2026-07-20T12:00:00.000Z'),
        endsAt: null,
      },
    ];

    expect(resolveCurrentCompetitionRound(rounds, now)?.round).toBe(2);
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
    expect(readModel).not.toContain('generateLeagueFixtures');
    expect(readModel).toContain('resolveAflRoundForScoring');
    expect(readModel).toContain('categoryRows: buildCategoryRows');
  });
});
