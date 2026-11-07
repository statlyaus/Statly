import { describe, expect, it } from 'vitest';

import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import { buildMatchupCard } from '@/server/leagues/matchupReadModel';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

const categories: FantasyCategoryKey[] = ['goals', 'tackles'];
const categoryDirections = normalizeCategoryDirections(categories);

function team(id: string) {
  return { id, teamName: `Team ${id}`, teamLogoUrl: null };
}

function persistedMatchup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'matchup-1',
    round: 3,
    status: 'SCHEDULED',
    startsAt: null,
    endsAt: null,
    finalizedAt: null,
    winnerMemberId: null,
    homeMemberId: 'home',
    awayMemberId: 'away',
    byeMemberId: null,
    homeMember: team('home'),
    awayMember: team('away'),
    byeMember: null,
    homeCategoryWins: 0,
    awayCategoryWins: 0,
    drawnCategories: 0,
    scores: [],
    ...overrides,
  } as unknown as Parameters<typeof buildMatchupCard>[0]['matchup'];
}

function lineup(playerIds: string[]) {
  return {
    players: playerIds.map((playerId, slotIndex) => ({
      playerId,
      slot: 'MID',
      slotIndex,
      player: { name: playerId, position: 'MID' },
    })),
  };
}

const lineupsByMemberId = new Map([
  ['home', lineup(['h1', 'h2'])],
  ['away', lineup(['a1'])],
]);
const totalsByPlayerId = new Map([
  ['h1', { goals: 2, tackles: 3 }],
  ['h2', { goals: 1, tackles: 1 }],
  ['a1', { goals: 1, tackles: 6 }],
]);

describe('buildMatchupCard live totals', () => {
  it('scores an unfinalized matchup from the live stats the player rows show, as provisional', () => {
    const card = buildMatchupCard({
      matchup: persistedMatchup(),
      categories,
      categoryDirections,
      scoringMode: 'H2H_EACH_CATEGORY',
      lineupsByMemberId,
      totalsByPlayerId,
      liveRound: { available: true, started: true },
    });

    expect(card.status).toBe('LIVE');
    expect(card.provisional).toBe(true);
    expect(
      card.categoryRows.map((row) => [row.category, row.homeValue, row.awayValue, row.winner])
    ).toEqual([
      ['goals', 3, 1, 'home'],
      ['tackles', 4, 6, 'away'],
    ]);
    expect([card.homeCategoryWins, card.awayCategoryWins, card.drawnCategories]).toEqual([1, 1, 0]);
  });

  it('keeps a matchup scheduled before any AFL game in the round has started', () => {
    const card = buildMatchupCard({
      matchup: persistedMatchup(),
      categories,
      categoryDirections,
      scoringMode: 'H2H_EACH_CATEGORY',
      lineupsByMemberId,
      totalsByPlayerId: new Map(),
      liveRound: { available: true, started: false },
    });

    expect(card.status).toBe('SCHEDULED');
  });

  it('shows the stored result once the matchup is final', () => {
    const card = buildMatchupCard({
      matchup: persistedMatchup({
        status: 'FINAL',
        homeCategoryWins: 2,
        awayCategoryWins: 0,
        scores: [
          {
            memberId: 'home',
            categoriesJson: [
              {
                category: 'goals',
                homeValue: 9,
                awayValue: 1,
                direction: 'HIGH_WINS',
                winner: 'home',
              },
              {
                category: 'tackles',
                homeValue: 9,
                awayValue: 1,
                direction: 'HIGH_WINS',
                winner: 'home',
              },
            ],
            categoryWins: 2,
            categoryLosses: 0,
            categoryDraws: 0,
            pointsFor: 18,
            pointsAgainst: 2,
            matchupWin: true,
            matchupLoss: false,
            matchupDraw: false,
          },
        ],
      }),
      categories,
      categoryDirections,
      scoringMode: 'H2H_EACH_CATEGORY',
      lineupsByMemberId,
      totalsByPlayerId,
      liveRound: { available: true, started: true },
    });

    expect(card.status).toBe('FINAL');
    expect(card.provisional).toBe(false);
    expect(card.categoryRows.map((row) => row.homeValue)).toEqual([9, 9]);
    expect(card.homeCategoryWins).toBe(2);
  });

  it('keeps the stored state when live stats cannot be loaded', () => {
    const card = buildMatchupCard({
      matchup: persistedMatchup({ status: 'LIVE', homeCategoryWins: 1 }),
      categories,
      categoryDirections,
      scoringMode: 'H2H_EACH_CATEGORY',
      lineupsByMemberId,
      totalsByPlayerId: new Map(),
      liveRound: { available: false, started: false },
    });

    expect(card.status).toBe('LIVE');
    expect(card.homeCategoryWins).toBe(1);
  });
});
