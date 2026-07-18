import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMPETITION_RULES } from '@/server/leagues/competitionRules';

const activityMocks = vi.hoisted(() => ({
  logLeagueActivity: vi.fn().mockResolvedValue(undefined),
}));

const etlMocks = vi.hoisted(() => ({
  getRoundMatches: vi.fn().mockResolvedValue([]),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

const txMocks = vi.hoisted(() => ({
  leagueSettings: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  leagueMatchupScore: { deleteMany: vi.fn() },
  leagueStanding: { deleteMany: vi.fn() },
  leagueLineup: { deleteMany: vi.fn() },
  leagueMatchup: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  leagueCompetitionRound: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  leagueCompetitionAudit: { create: vi.fn() },
}));

const prismaMocks = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  $transaction: vi.fn((work: (tx: typeof txMocks) => Promise<unknown>) => work(txMocks)),
}));

vi.mock('@/lib/activity', () => activityMocks);
vi.mock('@/lib/etlIntegration', () => etlMocks);
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import {
  publishCompetition,
  setCompetitionRoundFallbackDeadline,
} from '@/server/leagues/competitionService';

const rules = {
  ...DEFAULT_COMPETITION_RULES,
  regularSeasonRounds: 1,
  finalsTeams: 0 as const,
};

describe('publishCompetition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.logLeagueActivity.mockResolvedValue(undefined);
    prismaMocks.$transaction.mockImplementation((work) => work(txMocks));
    prismaMocks.league.findUnique.mockResolvedValue({
      id: 'league-1',
      settingsId: 'settings-1',
      categoriesJson: JSON.stringify(['goals']),
      settings: {
        competitionRulesVersion: 4,
        competitionRulesJson: null,
        lineupSlotsJson: null,
        rosterSize: 30,
      },
      members: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    });
    txMocks.leagueSettings.updateMany.mockResolvedValue({ count: 1 });
    txMocks.leagueSettings.update.mockResolvedValue({});
    txMocks.leagueMatchupScore.deleteMany.mockResolvedValue({ count: 8 });
    txMocks.leagueStanding.deleteMany.mockResolvedValue({ count: 4 });
    txMocks.leagueLineup.deleteMany.mockResolvedValue({ count: 4 });
    txMocks.leagueMatchup.deleteMany.mockResolvedValue({ count: 2 });
    txMocks.leagueCompetitionRound.deleteMany.mockResolvedValue({ count: 1 });
    txMocks.leagueCompetitionRound.create.mockResolvedValue({ id: 'competition-round-1' });
    txMocks.leagueMatchup.createMany.mockResolvedValue({ count: 2 });
    txMocks.leagueCompetitionAudit.create.mockResolvedValue({});
    etlMocks.getRoundMatches.mockResolvedValue([]);
  });

  it('claims the next version before resetting data and records bounded delete counts', async () => {
    const result = await publishCompetition({
      leagueId: 'league-1',
      actorMemberId: 'member-owner',
      rules,
    });

    expect(result).toEqual({ ok: true, fixtureVersion: 5, roundCount: 1 });
    expect(txMocks.leagueSettings.updateMany).toHaveBeenCalledWith({
      where: { id: 'settings-1', competitionRulesVersion: 4 },
      data: { competitionRulesVersion: { increment: 1 } },
    });
    expect(txMocks.leagueSettings.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      txMocks.leagueMatchupScore.deleteMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );

    const auditPayload = JSON.parse(
      txMocks.leagueCompetitionAudit.create.mock.calls[0]?.[0].data.payloadJson as string
    );
    expect(auditPayload.resetSummary).toEqual({
      matchupScores: 8,
      standings: 4,
      lineups: 4,
      matchups: 2,
      competitionRounds: 1,
    });
    expect(txMocks.leagueSettings.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      'competitionRulesVersion'
    );
  });

  it('does not delete derived data when another publisher wins the version claim', async () => {
    txMocks.leagueSettings.updateMany.mockResolvedValue({ count: 0 });

    const result = await publishCompetition({
      leagueId: 'league-1',
      actorMemberId: 'member-owner',
      rules,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        'Competition rules changed while publication was in progress. Try publishing again.',
      ],
    });
    expect(txMocks.leagueMatchupScore.deleteMany).not.toHaveBeenCalled();
    expect(txMocks.leagueCompetitionRound.deleteMany).not.toHaveBeenCalled();
  });

  it('publishes editable manual round shells without generating round-robin matchups', async () => {
    const result = await publishCompetition({
      leagueId: 'league-1',
      actorMemberId: 'member-owner',
      rules: { ...rules, fixtureGenerationMode: 'MANUAL' },
    });

    expect(result).toEqual({ ok: true, fixtureVersion: 5, roundCount: 1 });
    expect(etlMocks.getRoundMatches).toHaveBeenCalledWith(expect.any(Number), 1);
    expect(txMocks.leagueCompetitionRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fixtureVersion: 5,
        round: 1,
        phase: 'REGULAR',
      }),
    });
    expect(txMocks.leagueMatchup.createMany).not.toHaveBeenCalled();
    expect(txMocks.leagueSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ competitionStatus: 'PENDING' }) })
    );
  });

  it('keeps publication available when one AFL timing lookup fails', async () => {
    etlMocks.getRoundMatches.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await publishCompetition({
      leagueId: 'league-1',
      actorMemberId: 'member-owner',
      rules,
    });

    expect(result).toEqual({ ok: true, fixtureVersion: 5, roundCount: 1 });
    expect(txMocks.leagueCompetitionRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING', startsAt: null, endsAt: null }),
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Failed to hydrate official competition round timing',
      expect.objectContaining({ season: expect.any(Number), aflRound: 1 })
    );
  });
});

describe('setCompetitionRoundFallbackDeadline', () => {
  const now = new Date('2026-07-16T10:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    activityMocks.logLeagueActivity.mockResolvedValue(undefined);
    prismaMocks.$transaction.mockImplementation((work) => work(txMocks));
    txMocks.leagueCompetitionAudit.create.mockResolvedValue({});
    txMocks.leagueCompetitionRound.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects overrides unless fixture data is pending', async () => {
    txMocks.leagueCompetitionRound.findFirst.mockResolvedValue({
      id: 'round-1',
      status: 'SCHEDULED',
      startsAt: new Date('2026-07-16T13:00:00.000Z'),
      lockedAt: null,
    });

    const result = await setCompetitionRoundFallbackDeadline({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'member-owner',
      fallbackLockAt: new Date('2026-07-16T12:00:00.000Z'),
      now,
    });

    expect(result).toEqual({
      ok: false,
      error: 'A fallback deadline can only be set while fixture data is pending.',
    });
    expect(txMocks.leagueCompetitionRound.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow a pending fallback after the earliest known lock or start', async () => {
    txMocks.leagueCompetitionRound.findFirst.mockResolvedValue({
      id: 'round-1',
      status: 'PENDING',
      publishedAt: new Date('2026-07-14T10:00:00.000Z'),
      startsAt: new Date('2026-07-16T14:00:00.000Z'),
      lockedAt: new Date('2026-07-16T13:00:00.000Z'),
    });

    const result = await setCompetitionRoundFallbackDeadline({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'member-owner',
      fallbackLockAt: new Date('2026-07-16T13:30:00.000Z'),
      now,
    });

    expect(result).toEqual({
      ok: false,
      error: 'The fallback deadline cannot be later than the known round lock or AFL start.',
    });
    expect(txMocks.leagueCompetitionRound.updateMany).not.toHaveBeenCalled();
  });

  it('requires fixture data to remain pending for 24 hours before an override', async () => {
    txMocks.leagueCompetitionRound.findFirst.mockResolvedValue({
      id: 'round-1',
      status: 'PENDING',
      publishedAt: new Date('2026-07-16T00:00:00.000Z'),
      startsAt: null,
      lockedAt: null,
    });

    const result = await setCompetitionRoundFallbackDeadline({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'member-owner',
      fallbackLockAt: new Date('2026-07-16T12:00:00.000Z'),
      now,
    });

    expect(result).toEqual({
      ok: false,
      error:
        'A fallback deadline becomes available after fixture data has been pending for 24 hours (2026-07-17T00:00:00.000Z).',
    });
    expect(txMocks.leagueCompetitionRound.updateMany).not.toHaveBeenCalled();
  });

  it('allows a pending fallback exactly at the earliest known boundary', async () => {
    const knownLockAt = new Date('2026-07-16T13:00:00.000Z');
    txMocks.leagueCompetitionRound.findFirst.mockResolvedValue({
      id: 'round-1',
      status: 'PENDING',
      publishedAt: new Date('2026-07-14T10:00:00.000Z'),
      startsAt: new Date('2026-07-16T14:00:00.000Z'),
      lockedAt: knownLockAt,
    });

    const result = await setCompetitionRoundFallbackDeadline({
      leagueId: 'league-1',
      round: 1,
      actorMemberId: 'member-owner',
      fallbackLockAt: knownLockAt,
      now,
    });

    expect(result).toEqual({ ok: true });
    expect(txMocks.leagueCompetitionRound.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'round-1',
        status: 'PENDING',
        startsAt: new Date('2026-07-16T14:00:00.000Z'),
        lockedAt: knownLockAt,
      },
      data: { fallbackLockAt: knownLockAt },
    });
    expect(txMocks.leagueCompetitionAudit.create).toHaveBeenCalledOnce();
  });
});
