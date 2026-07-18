import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({
  logLeagueActivity: vi.fn().mockResolvedValue(undefined),
}));

const txMocks = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueMember: { count: vi.fn(), findMany: vi.fn() },
  leagueCompetitionRound: { findUnique: vi.fn() },
  leagueMatchup: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  leagueMatchupScore: { deleteMany: vi.fn(), findMany: vi.fn() },
  leagueLineup: { deleteMany: vi.fn() },
  leagueStanding: { deleteMany: vi.fn(), createMany: vi.fn() },
  leagueCompetitionAudit: { create: vi.fn() },
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn((work: (tx: typeof txMocks) => Promise<unknown>) => work(txMocks)),
}));

vi.mock('@/lib/activity', () => activityMocks);
vi.mock('@/lib/etlIntegration', () => ({ getRoundMatches: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import {
  deleteCompetitionFixture,
  saveCompetitionFixture,
} from '@/server/leagues/competitionService';

describe('competition fixture mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.logLeagueActivity.mockResolvedValue(undefined);
    prismaMocks.$transaction.mockImplementation((work) => work(txMocks));
    txMocks.league.findUnique.mockResolvedValue({
      settings: { competitionRulesVersion: 2, scoringMode: 'H2H_EACH_CATEGORY' },
    });
    txMocks.leagueCompetitionRound.findUnique.mockResolvedValue({
      id: 'competition-round-1',
      phase: 'REGULAR',
      status: 'SCHEDULED',
      startsAt: new Date('2026-04-02T09:00:00.000Z'),
      endsAt: new Date('2026-04-05T09:00:00.000Z'),
    });
    txMocks.leagueMember.count.mockResolvedValue(2);
    txMocks.leagueMember.findMany.mockResolvedValue([{ id: 'member-1' }, { id: 'member-2' }]);
    txMocks.leagueMatchup.findFirst.mockResolvedValue(null);
    txMocks.leagueMatchup.create.mockResolvedValue({
      id: 'fixture-1',
      round: 1,
      homeMemberId: 'member-1',
      awayMemberId: 'member-2',
      byeMemberId: null,
    });
    txMocks.leagueMatchup.update.mockResolvedValue({
      id: 'fixture-1',
      round: 1,
      homeMemberId: 'member-1',
      awayMemberId: 'member-2',
      byeMemberId: null,
    });
    txMocks.leagueMatchupScore.deleteMany.mockResolvedValue({ count: 1 });
    txMocks.leagueMatchupScore.findMany.mockResolvedValue([]);
    txMocks.leagueLineup.deleteMany.mockResolvedValue({ count: 2 });
    txMocks.leagueStanding.deleteMany.mockResolvedValue({ count: 4 });
    txMocks.leagueStanding.createMany.mockResolvedValue({ count: 2 });
    txMocks.leagueMatchup.delete.mockResolvedValue({});
    txMocks.leagueCompetitionAudit.create.mockResolvedValue({});
  });

  it('creates a manual fixture without deleting prepared lineups or standings', async () => {
    const result = await saveCompetitionFixture({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'commissioner-1',
      fixture: { homeMemberId: 'member-1', awayMemberId: 'member-2' },
    });

    expect(result).toEqual({
      ok: true,
      fixture: {
        id: 'fixture-1',
        round: 1,
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
        byeMemberId: null,
      },
    });
    expect(txMocks.leagueMatchup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        fixtureVersion: 2,
        competitionRoundId: 'competition-round-1',
        round: 1,
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
      }),
    });
    expect(txMocks.leagueLineup.deleteMany).not.toHaveBeenCalled();
    expect(txMocks.leagueStanding.deleteMany).not.toHaveBeenCalled();
    expect(txMocks.leagueCompetitionAudit.create).toHaveBeenCalledOnce();
  });

  it('rejects a team that already has a fixture in the round', async () => {
    txMocks.leagueMatchup.findFirst.mockResolvedValue({ id: 'fixture-existing' });

    const result = await saveCompetitionFixture({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'commissioner-1',
      fixture: { homeMemberId: 'member-1', awayMemberId: 'member-2' },
    });

    expect(result).toEqual({
      ok: false,
      error: 'A selected team already has a fixture in this round.',
    });
    expect(txMocks.leagueMatchup.create).not.toHaveBeenCalled();
  });

  it('requires finals changes to target a published bracket fixture', async () => {
    txMocks.leagueCompetitionRound.findUnique.mockResolvedValue({
      id: 'competition-round-finals',
      phase: 'FINALS',
      status: 'SCHEDULED',
      startsAt: new Date('2026-09-03T09:00:00.000Z'),
      endsAt: new Date('2026-09-06T09:00:00.000Z'),
    });

    const result = await saveCompetitionFixture({
      leagueId: 'league-1',
      round: 12,
      actorMemberId: 'commissioner-1',
      fixture: { homeMemberId: 'member-1', awayMemberId: 'member-2' },
    });

    expect(result).toEqual({
      ok: false,
      error: 'Finals fixtures must use the published bracket slots.',
    });
    expect(txMocks.leagueMatchup.create).not.toHaveBeenCalled();
  });

  it('deletes an editable fixture and rebuilds standings after removing scores', async () => {
    txMocks.leagueMatchup.findFirst.mockResolvedValue({
      id: 'fixture-1',
      homeMemberId: 'member-1',
      awayMemberId: 'member-2',
      byeMemberId: null,
      competitionRound: { status: 'SCHEDULED' },
    });

    const result = await deleteCompetitionFixture({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'commissioner-1',
      matchupId: 'fixture-1',
    });

    expect(result).toEqual({ ok: true });
    expect(txMocks.leagueMatchupScore.deleteMany).toHaveBeenCalledWith({
      where: { matchupId: 'fixture-1' },
    });
    expect(txMocks.leagueMatchup.delete).toHaveBeenCalledWith({ where: { id: 'fixture-1' } });
    expect(txMocks.leagueStanding.deleteMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
    });
    expect(txMocks.leagueStanding.createMany).toHaveBeenCalledOnce();
    expect(txMocks.leagueCompetitionAudit.create).toHaveBeenCalledOnce();
  });

  it('preserves finals bracket placeholders during fixture deletion', async () => {
    txMocks.leagueMatchup.findFirst.mockResolvedValue({
      id: 'fixture-finals',
      bracketKey: 'GF',
      homeMemberId: null,
      awayMemberId: null,
      byeMemberId: null,
      competitionRound: { status: 'SCHEDULED' },
    });

    const result = await deleteCompetitionFixture({
      leagueId: 'league-1',
      round: 14,
      actorMemberId: 'commissioner-1',
      matchupId: 'fixture-finals',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Finals bracket fixtures cannot be deleted. Edit the participants instead.',
    });
    expect(txMocks.leagueMatchup.delete).not.toHaveBeenCalled();
  });
});
