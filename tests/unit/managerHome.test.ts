import { describe, expect, it, vi } from 'vitest';

import { deriveSeasonStatus, loadManagerHome } from '@/server/dashboard/managerHome';
import type { LeagueSeasonState } from '@/server/leagues/seasonState';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: vi.fn(),
}));

const now = new Date('2026-09-26T10:00:00.000Z');

function member(id: string, teamName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    teamName,
    teamLogoUrl: null,
    draftSlot: null,
    isActive: true,
    status: 'ACTIVE',
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  const { league: leagueOverrides, ...rest } = overrides as {
    league?: Record<string, unknown>;
  };
  return {
    id: 'member-1',
    role: 'MANAGER',
    teamName: 'Ball Magnets',
    teamLogoUrl: null,
    isActive: true,
    status: 'ACTIVE',
    league: {
      id: 'league-1',
      name: 'Friday Night League',
      categoriesJson: JSON.stringify(['goals', 'tackles']),
      settings: {
        maxTeams: 10,
        timeZone: 'Australia/Melbourne',
        startAt: new Date('2026-10-03T09:30:00.000Z'),
        lineupSlotsJson: null,
      },
      activeSeason: { label: '2026 Season' },
      drafts: [],
      members: [
        member('member-1', 'Ball Magnets'),
        member('member-2', 'Hard Ball Gets'),
        member('member-3', 'Gone FC', { isActive: false, status: 'REMOVED' }),
      ],
      ...leagueOverrides,
    },
    ...rest,
  };
}

function buildClient(input: {
  memberships: unknown[];
  offers?: unknown[];
  claims?: unknown[];
  standings?: unknown[];
  matchup?: unknown;
  lineup?: unknown;
  recentScores?: unknown[];
}) {
  return {
    leagueMember: { findMany: vi.fn().mockResolvedValue(input.memberships) },
    leagueTradeOffer: { findMany: vi.fn().mockResolvedValue(input.offers ?? []) },
    teamAction: { findMany: vi.fn().mockResolvedValue(input.claims ?? []) },
    leagueStanding: { findMany: vi.fn().mockResolvedValue(input.standings ?? []) },
    leagueMatchup: { findFirst: vi.fn().mockResolvedValue(input.matchup ?? null) },
    leagueLineup: { findUnique: vi.fn().mockResolvedValue(input.lineup ?? null) },
    leagueMatchupScore: { findMany: vi.fn().mockResolvedValue(input.recentScores ?? []) },
    league: {},
    leagueCompetitionRound: {},
  };
}

function seasonState(overrides: Partial<LeagueSeasonState> = {}): LeagueSeasonState {
  return {
    leagueId: 'league-1',
    season: null,
    competitionStatus: 'ACTIVE',
    fixtureVersion: 1,
    schedule: [],
    ...overrides,
  };
}

function round(status: 'scheduled' | 'no_matchup' | 'in_progress' | 'final', n: number) {
  return {
    id: `round-${n}`,
    round: n,
    roundLabel: `Round ${n}`,
    aflRound: n,
    phase: 'regular' as const,
    status,
    current: status === 'in_progress',
    startsAt: `2026-09-2${n}T09:00:00.000Z`,
    endsAt: `2026-09-2${n + 1}T09:00:00.000Z`,
  };
}

function standing(memberId: string, wins: number, losses: number) {
  return {
    id: `standing-${memberId}`,
    memberId,
    wins,
    losses,
    draws: 0,
    categoryWins: wins * 5,
    categoryLosses: losses * 5,
    categoryDraws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

describe('loadManagerHome', () => {
  it('returns no leagues when the user has no active membership', async () => {
    const client = buildClient({
      memberships: [membership({ isActive: false, status: 'REMOVED' })],
    });

    const home = await loadManagerHome({ userId: 'user-1', now }, client as never);

    expect(home.leagues).toEqual([]);
    expect(client.leagueTradeOffer.findMany).not.toHaveBeenCalled();
  });

  it('reports real member counts, the league timezone and a scheduled draft', async () => {
    const client = buildClient({ memberships: [membership()] });

    const home = await loadManagerHome({ userId: 'user-1', now }, client as never);

    expect(home.leagues).toEqual([
      {
        leagueId: 'league-1',
        leagueName: 'Friday Night League',
        teamName: 'Ball Magnets',
        logoUrl: null,
        role: 'manager',
        memberCount: 2,
        maxTeams: 10,
        timeZone: 'Australia/Melbourne',
        seasonLabel: '2026 Season',
        status: { kind: 'draft_scheduled', draftId: null, startsAt: '2026-10-03T09:30:00.000Z' },
        record: null,
        matchup: null,
        lineup: null,
        form: [],
        ladder: null,
        tradeOffersAwaitingYou: { count: 0, earliestExpiresAt: null },
        pendingWaiverClaims: 0,
      },
    ]);
    expect(client.leagueMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
    expect(client.leagueStanding.findMany).not.toHaveBeenCalled();
  });

  it('marks live drafts with the pick on the clock and owners as commissioners', async () => {
    const client = buildClient({
      memberships: [
        membership({
          role: 'OWNER',
          league: { drafts: [{ id: 'draft-9', status: 'LIVE', currentPick: 37, totalPicks: 220 }] },
        }),
      ],
    });

    const home = await loadManagerHome({ userId: 'user-1', now }, client as never);

    expect(home.leagues[0].role).toBe('commissioner');
    expect(home.leagues[0].status).toEqual({
      kind: 'draft_live',
      draftId: 'draft-9',
      currentPick: 37,
      totalPicks: 220,
    });
  });

  it('only counts unexpired proposed offers sent to this user, and their pending claims', async () => {
    const client = buildClient({
      memberships: [membership()],
      offers: [
        { recipientMemberId: 'member-1', expiresAt: new Date('2026-09-28T00:00:00.000Z') },
        { recipientMemberId: 'member-1', expiresAt: new Date('2026-09-27T00:00:00.000Z') },
      ],
      claims: [{ memberId: 'member-1' }],
    });

    const home = await loadManagerHome({ userId: 'user-1', now }, client as never);

    expect(client.leagueTradeOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipientMemberId: { in: ['member-1'] },
          status: 'PROPOSED',
          expiresAt: { gt: now },
        },
      })
    );
    expect(home.leagues[0].tradeOffersAwaitingYou).toEqual({
      count: 2,
      earliestExpiresAt: '2026-09-27T00:00:00.000Z',
    });
    expect(home.leagues[0].pendingWaiverClaims).toBe(1);
  });

  it('builds the record, live matchup and next-round lineup once the draft is complete', async () => {
    const client = buildClient({
      memberships: [
        membership({
          league: { drafts: [{ id: 'd', status: 'COMPLETED', currentPick: 1, totalPicks: 1 }] },
        }),
      ],
      standings: [standing('member-1', 2, 1), standing('member-2', 3, 0)],
      matchup: {
        homeMemberId: 'member-2',
        awayMemberId: 'member-1',
        homeCategoryWins: 1,
        awayCategoryWins: 1,
        scores: [
          {
            categoriesJson: JSON.stringify([
              { category: 'goals', homeValue: 9, awayValue: 12, winner: 'away' },
              { category: 'tackles', homeValue: 60, awayValue: 50, winner: 'home' },
            ]),
          },
        ],
      },
      lineup: { players: Array.from({ length: 15 }, (_, index) => ({ id: `p${index}` })) },
      recentScores: [
        { matchupWin: true, matchupLoss: false },
        { matchupWin: false, matchupLoss: true },
        { matchupWin: false, matchupLoss: false },
      ],
    });
    const loadSeasonState = vi.fn().mockResolvedValue(
      seasonState({
        schedule: [round('final', 1), round('in_progress', 2), round('scheduled', 3)],
      })
    );

    const [league] = (
      await loadManagerHome({ userId: 'user-1', now }, client as never, loadSeasonState)
    ).leagues;

    expect(loadSeasonState).toHaveBeenCalledWith({ leagueId: 'league-1', userId: 'user-1', now });
    expect(league.status).toEqual({
      kind: 'round_live',
      roundLabel: 'Round 2',
      endsAt: '2026-09-23T09:00:00.000Z',
    });
    expect(league.record).toEqual({ wins: 2, losses: 1, draws: 0, rank: 2, teams: 2 });
    expect(league.form).toEqual(['W', 'L', 'D']);
    expect(client.leagueMatchupScore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', memberId: 'member-1', status: 'FINAL' },
        take: 5,
      })
    );
    expect(league.ladder?.map((row) => [row.position, row.teamName, row.isYou])).toEqual([
      [1, 'Hard Ball Gets', false],
      [2, 'Ball Magnets', true],
    ]);
    expect(client.leagueMatchup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          competitionRoundId: 'round-2',
          OR: [
            { homeMemberId: 'member-1' },
            { awayMemberId: 'member-1' },
            { byeMemberId: 'member-1' },
          ],
        },
      })
    );
    expect(league.matchup).toMatchObject({
      roundLabel: 'Round 2',
      status: 'live',
      yourCategoryWins: 1,
      opponentCategoryWins: 1,
      opponent: { teamName: 'Hard Ball Gets', logoUrl: null },
      categories: [
        { key: 'goals', shortLabel: 'G', result: 'won', yourValue: 12, opponentValue: 9 },
        { key: 'tackles', shortLabel: 'T', result: 'lost', yourValue: 50, opponentValue: 60 },
      ],
    });
    expect(league.lineup).toEqual({
      roundLabel: 'Round 3',
      filled: 15,
      required: 19,
      locksAt: '2026-09-23T09:00:00.000Z',
    });
  });
});

describe('deriveSeasonStatus', () => {
  it('treats a missing or unpublished season as setup', () => {
    expect(deriveSeasonStatus(null)).toEqual({ kind: 'season_setup' });
    expect(deriveSeasonStatus(seasonState({ competitionStatus: 'SETUP' }))).toEqual({
      kind: 'season_setup',
    });
  });

  it('returns the next scheduled round when nothing is live', () => {
    expect(
      deriveSeasonStatus(seasonState({ schedule: [round('final', 1), round('scheduled', 2)] }))
    ).toEqual({
      kind: 'round_upcoming',
      roundLabel: 'Round 2',
      startsAt: '2026-09-22T09:00:00.000Z',
    });
  });

  it('reports a complete season', () => {
    expect(deriveSeasonStatus(seasonState({ competitionStatus: 'COMPLETE' }))).toEqual({
      kind: 'season_complete',
    });
    expect(deriveSeasonStatus(seasonState({ schedule: [round('final', 1)] }))).toEqual({
      kind: 'season_complete',
    });
  });
});
