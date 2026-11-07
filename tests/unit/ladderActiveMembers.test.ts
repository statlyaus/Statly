import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  league: { findUnique: vi.fn() },
  leagueCompetitionRound: { findUnique: vi.fn(), findMany: vi.fn() },
  leagueMatchup: { findMany: vi.fn() },
  leagueMatchupScore: { findMany: vi.fn() },
  leagueStanding: { findMany: vi.fn() },
  leagueLineup: { findMany: vi.fn() },
  leagueMember: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundPlayerStatsResult: vi.fn().mockResolvedValue({ ok: true, stats: [] }),
  getRoundMatchesResult: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
}));

import {
  loadLeagueMatchupReadModel,
  recalculateLeagueRoundMatchups,
} from '@/server/leagues/matchupReadModel';
import { loadLeagueStandingsHistory } from '@/server/leagues/standingsHistoryLoader';

const league = {
  id: 'league-1',
  categoriesJson: ['goals'],
  settings: {
    scoringMode: 'H2H_EACH_CATEGORY',
    fixtureGenerationMode: 'AUTOMATIC',
    lineupSlotsJson: null,
    categoryDirectionsJson: null,
    competitionStatus: 'ACTIVE',
    competitionRulesJson: null,
    competitionRulesVersion: 1,
  },
};

// A removed manager's team must not reach the ladder, standings or finals seeding.
const activeOnly = expect.objectContaining({ where: { leagueId: 'league-1', isActive: true } });

describe('ladder members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.league.findUnique.mockResolvedValue(league);
    prismaMocks.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prismaMocks.leagueMember.findMany.mockResolvedValue([]);
    prismaMocks.leagueCompetitionRound.findMany.mockResolvedValue([]);
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue(null);
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([]);
    prismaMocks.leagueMatchupScore.findMany.mockResolvedValue([]);
    prismaMocks.leagueStanding.findMany.mockResolvedValue([]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue([]);
  });

  it('builds the Matchups ladder from active members only', async () => {
    await loadLeagueMatchupReadModel({ leagueId: 'league-1', userId: 'user-1', canManage: false });

    expect(prismaMocks.leagueMember.findMany).toHaveBeenCalledWith(activeOnly);
  });

  it('builds the Standings ladder from active members only', async () => {
    await loadLeagueStandingsHistory('league-1');

    expect(prismaMocks.leagueMember.findMany).toHaveBeenCalledWith(activeOnly);
  });

  it('recalculates standings and seeds finals from active members only', async () => {
    await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 1 });

    expect(prismaMocks.leagueMember.findMany).toHaveBeenCalledWith(activeOnly);
  });
});
