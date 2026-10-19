import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlayers: vi.fn(),
  loadLineupRoundSummaries: vi.fn(),
  loadRoundPlayerFixtures: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('@/lib/data', () => ({ getPlayers: mocks.getPlayers }));
vi.mock('@/server/leagues/lineupService', () => ({
  loadLineupRoundSummaries: mocks.loadLineupRoundSummaries,
  loadRoundPlayerFixtures: mocks.loadRoundPlayerFixtures,
}));

import type { InjuryListing } from '@/server/injuries/injuryListReadModel';

import { ensureDefaultLineups, toAutoFillPlayers } from './defaultLineups';

type RosterRow = { memberId: string; playerId: string; position: string; club?: string };
type InjuryEntry = { playerId: string; status: string; injuryRaw: string; returnRaw: string };

const NOW = new Date('2026-07-18T00:00:00.000Z');

function injurySnapshot(entries: InjuryEntry[], confirmedAt = NOW) {
  return { id: 'snapshot-1', confirmedAt, entries };
}

function lookup(listings: Record<string, InjuryListing>) {
  return (player: { playerId: string }) => listings[player.playerId] ?? null;
}

function buildClient({
  existingMemberIds = [] as string[],
  previousByMember = {} as Record<string, unknown>,
  roster = [] as RosterRow[],
  lineupSlots = { DEF: 1, MID: 1, RUC: 1, FWD: 1, UTIL: 1 },
  interchangeSlots = 1,
  injurySnapshot = null as ReturnType<typeof injurySnapshot> | null,
} = {}) {
  return {
    injuryListSnapshot: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          injurySnapshot && { id: injurySnapshot.id, confirmedAt: injurySnapshot.confirmedAt }
        ),
    },
    injuryListEntry: { findMany: vi.fn().mockResolvedValue(injurySnapshot?.entries ?? []) },
    league: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'league-1',
        categoriesJson: null,
        settings: {
          lineupSlotsJson: lineupSlots,
          competitionRulesJson: { interchangeSlots },
          categoryDirectionsJson: null,
        },
      }),
    },
    leagueLineup: {
      findMany: vi.fn().mockResolvedValue(existingMemberIds.map((memberId) => ({ memberId }))),
      findFirst: vi.fn(({ where }: { where: { memberId: string } }) =>
        Promise.resolve(previousByMember[where.memberId] ?? null)
      ),
      create: vi.fn().mockResolvedValue({ id: 'new-lineup' }),
    },
    leagueRosterPlayer: {
      findMany: vi.fn().mockResolvedValue(
        roster.map((row) => ({
          memberId: row.memberId,
          playerId: row.playerId,
          player: {
            name: row.playerId,
            club: row.club ?? 'Carlton',
            position: row.position,
          },
        }))
      ),
    },
  };
}

function createdPlayers(client: ReturnType<typeof buildClient>, call = 0) {
  return (
    client.leagueLineup.create.mock.calls[call][0] as {
      data: { memberId: string; players: { create: unknown[] } };
    }
  ).data;
}

describe('ensureDefaultLineups', () => {
  beforeEach(() => {
    mocks.warn.mockClear();
    mocks.getPlayers.mockResolvedValue([]);
    mocks.loadLineupRoundSummaries.mockResolvedValue([{ round: 4, aflRound: 22 }]);
    mocks.loadRoundPlayerFixtures.mockResolvedValue({ ok: true, fixturesByPlayerId: new Map() });
  });

  it('carries the previous lineup forward and fills vacated spots by position', async () => {
    const client = buildClient({
      previousByMember: {
        'member-1': {
          round: 3,
          players: [
            { playerId: 'mid', slot: 'MID', slotIndex: 0 },
            { playerId: 'dropped', slot: 'FWD', slotIndex: 0 },
            // Out of position under the current listing: not carried.
            { playerId: 'def', slot: 'RUC', slotIndex: 0 },
            { playerId: 'x-bench', slot: 'BENCH', slotIndex: 0 },
          ],
        },
      },
      roster: [
        { memberId: 'member-1', playerId: 'mid', position: 'MID' },
        { memberId: 'member-1', playerId: 'def', position: 'DEF' },
        { memberId: 'member-1', playerId: 'ruc', position: 'RUC' },
        { memberId: 'member-1', playerId: 'fwd', position: 'FWD' },
        // Equal scores fall back to id order, so the specialist forward takes FWD first.
        { memberId: 'member-1', playerId: 'x-bench', position: 'MID/FWD' },
      ],
    });

    const created = await ensureDefaultLineups({
      leagueId: 'league-1',
      round: 4,
      memberIds: ['member-1'],
      client: client as never,
    });

    expect(created).toBe(1);
    expect(mocks.loadRoundPlayerFixtures).toHaveBeenCalledWith(
      expect.objectContaining({ aflRound: 22 })
    );
    expect(createdPlayers(client).players.create).toEqual(
      expect.arrayContaining([
        { playerId: 'mid', slot: 'MID', slotIndex: 0 },
        { playerId: 'def', slot: 'DEF', slotIndex: 0 },
        { playerId: 'ruc', slot: 'RUC', slotIndex: 0 },
        { playerId: 'fwd', slot: 'FWD', slotIndex: 0 },
        { playerId: 'x-bench', slot: 'UTIL', slotIndex: 0 },
      ])
    );
    expect(createdPlayers(client).players.create).toHaveLength(5);
  });

  it('builds a lineup by position for a team that never set one, leaving out byes and injuries', async () => {
    mocks.loadRoundPlayerFixtures.mockResolvedValue({
      ok: true,
      fixturesByPlayerId: new Map([['bye-fwd', { bye: true, startsAt: null }]]),
    });
    const client = buildClient({
      lineupSlots: { DEF: 1, MID: 0, RUC: 0, FWD: 1, UTIL: 0 },
      interchangeSlots: 0,
      injurySnapshot: injurySnapshot([
        { playerId: 'hurt-def', status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' },
      ]),
      roster: [
        { memberId: 'member-2', playerId: 'hurt-def', position: 'DEF' },
        { memberId: 'member-2', playerId: 'fit-def', position: 'DEF/FWD' },
        { memberId: 'member-2', playerId: 'bye-fwd', position: 'FWD' },
      ],
    });

    await ensureDefaultLineups({
      leagueId: 'league-1',
      round: 1,
      memberIds: ['member-2'],
      now: NOW,
      client: client as never,
    });

    // Only one fit player can fill the two spots; the FWD spot stays empty rather than take an
    // injured or bye player, and nobody plays out of position.
    expect(createdPlayers(client).players.create).toEqual([
      { playerId: 'fit-def', slot: 'DEF', slotIndex: 0 },
    ]);
  });

  it('leaves members who already have a lineup, or have no squad, untouched', async () => {
    const client = buildClient({ existingMemberIds: ['member-1'] });

    const created = await ensureDefaultLineups({
      leagueId: 'league-1',
      round: 4,
      memberIds: ['member-1', 'member-2', 'member-2'],
      client: client as never,
    });

    expect(created).toBe(0);
    expect(client.leagueLineup.create).not.toHaveBeenCalled();
  });

  it('still builds a default when the fixture and player feeds fail', async () => {
    mocks.loadLineupRoundSummaries.mockRejectedValue(new Error('down'));
    mocks.loadRoundPlayerFixtures.mockRejectedValue(new Error('down'));
    mocks.getPlayers.mockRejectedValue(new Error('down'));
    const client = buildClient({
      lineupSlots: { DEF: 0, MID: 1, RUC: 0, FWD: 0, UTIL: 0 },
      interchangeSlots: 0,
      roster: [{ memberId: 'member-1', playerId: 'mid', position: 'MID' }],
    });

    await expect(
      ensureDefaultLineups({
        leagueId: 'league-1',
        round: 2,
        memberIds: ['member-1'],
        client: client as never,
      })
    ).resolves.toBe(1);
  });

  it('picks a player listed as Test, and warns but benches nobody when the list is stale', async () => {
    const client = buildClient({
      lineupSlots: { DEF: 1, MID: 0, RUC: 0, FWD: 0, UTIL: 0 },
      interchangeSlots: 0,
      roster: [{ memberId: 'member-1', playerId: 'test-def', position: 'DEF' }],
      injurySnapshot: injurySnapshot([
        { playerId: 'test-def', status: 'TEST', injuryRaw: 'Knee', returnRaw: 'Test' },
      ]),
    });
    await ensureDefaultLineups({
      leagueId: 'league-1',
      round: 1,
      memberIds: ['member-1'],
      now: NOW,
      client: client as never,
    });
    expect(createdPlayers(client).players.create).toEqual([
      { playerId: 'test-def', slot: 'DEF', slotIndex: 0 },
    ]);
    expect(mocks.warn).not.toHaveBeenCalledWith('Injury list unavailable', expect.anything());

    const staleClient = buildClient({
      lineupSlots: { DEF: 1, MID: 0, RUC: 0, FWD: 0, UTIL: 0 },
      interchangeSlots: 0,
      roster: [{ memberId: 'member-1', playerId: 'hurt-def', position: 'DEF' }],
      injurySnapshot: injurySnapshot(
        [{ playerId: 'hurt-def', status: 'SEASON', injuryRaw: 'Knee', returnRaw: 'Season' }],
        new Date('2026-07-01T00:00:00.000Z')
      ),
    });
    await ensureDefaultLineups({
      leagueId: 'league-1',
      round: 1,
      memberIds: ['member-1'],
      now: NOW,
      client: staleClient as never,
    });
    expect(createdPlayers(staleClient).players.create).toEqual([
      { playerId: 'hurt-def', slot: 'DEF', slotIndex: 0 },
    ]);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith('Injury list unavailable', {
      leagueId: 'league-1',
      scope: 'default lineups',
      reason: 'stale',
    });
  });
});

describe('toAutoFillPlayers', () => {
  const roster = [
    { playerId: 'test-player', name: 'Test Player', position: 'MID' },
    { playerId: 'season-player', name: 'Season Player', position: 'MID' },
    { playerId: 'fit-player', name: 'Fit Player', position: 'MID' },
  ];

  function availability(injuryFor: (player: { playerId: string }) => InjuryListing | null) {
    return toAutoFillPlayers({
      roster,
      fixturesByPlayerId: new Map(),
      injuryFor,
      scores: new Map(),
      now: NOW,
    }).map((player) => [player.playerId, player.available]);
  }

  it('leaves a non-blocking (Test) listing available and benches a blocking one', () => {
    expect(
      availability(
        lookup({
          'test-player': { label: 'Knee (Test)', blocksSelection: false },
          'season-player': { label: 'ACL (Season)', blocksSelection: true },
        })
      )
    ).toEqual([
      ['test-player', true],
      ['season-player', false],
      ['fit-player', true],
    ]);
  });

  it('counts everyone as available without a current list', () => {
    expect(availability(() => null)).toEqual([
      ['test-player', true],
      ['season-player', true],
      ['fit-player', true],
    ]);
  });

  it('matches by player id only, never by a shared name', () => {
    const players = toAutoFillPlayers({
      roster: [
        { playerId: 'listed-id', name: 'Josh Kelly', position: 'MID' },
        { playerId: 'namesake-id', name: 'Josh Kelly', position: 'MID' },
      ],
      fixturesByPlayerId: new Map(),
      injuryFor: lookup({
        'listed-id': { label: 'Hamstring (2-3 weeks)', blocksSelection: true },
      }),
      scores: new Map(),
      now: NOW,
    });

    expect(players.map((player) => [player.playerId, player.available])).toEqual([
      ['listed-id', false],
      ['namesake-id', true],
    ]);
  });
});
