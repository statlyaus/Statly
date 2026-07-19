import { describe, expect, it } from 'vitest';

import { buildLeagueStandings } from './standingsReadModel';

describe('buildLeagueStandings', () => {
  it('resolves current team names, excludes stale rows, and appends missing current teams', () => {
    const standings = buildLeagueStandings({
      members: [
        { id: 'member-1', teamName: 'Robbo Rockers', teamLogoUrl: null },
        { id: 'member-2', teamName: 'AFL Legends', teamLogoUrl: '/logos/Adelaide.svg' },
      ],
      standings: [
        {
          id: 'standing-stale',
          memberId: 'former-member',
          wins: 9,
          losses: 0,
          draws: 0,
          categoryWins: 60,
          categoryLosses: 0,
          categoryDraws: 0,
          pointsFor: 900,
          pointsAgainst: 400,
        },
        {
          id: 'standing-1',
          memberId: 'member-1',
          wins: 3,
          losses: 1,
          draws: 0,
          categoryWins: 24,
          categoryLosses: 12,
          categoryDraws: 0,
          pointsFor: 450,
          pointsAgainst: 400,
        },
      ],
    });

    expect(standings).toEqual([
      expect.objectContaining({
        id: 'standing-1',
        memberId: 'member-1',
        teamName: 'Robbo Rockers',
        wins: 3,
      }),
      expect.objectContaining({
        id: 'pending-member-2',
        memberId: 'member-2',
        teamName: 'AFL Legends',
        teamLogoUrl: '/logos/Adelaide.svg',
        wins: 0,
        categoryWins: 0,
      }),
    ]);
  });

  it('returns every active team with a zero record before standings are persisted', () => {
    expect(
      buildLeagueStandings({
        members: [{ id: 'member-1', teamName: 'Robbo Rockers', teamLogoUrl: null }],
        standings: [],
      })
    ).toEqual([
      {
        id: 'pending-member-1',
        memberId: 'member-1',
        teamName: 'Robbo Rockers',
        teamLogoUrl: null,
        wins: 0,
        losses: 0,
        draws: 0,
        categoryWins: 0,
        categoryLosses: 0,
        categoryDraws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        tieBreakCategoryTotal: 0,
        draftSlot: null,
      },
    ]);
  });

  it('breaks an otherwise equal record by the selected HIGH_WINS category total and then draft seed', () => {
    const standings = buildLeagueStandings({
      members: [
        { id: 'member-1', teamName: 'Second seed', teamLogoUrl: null, draftSlot: 2 },
        { id: 'member-2', teamName: 'First seed', teamLogoUrl: null, draftSlot: 1 },
        { id: 'member-3', teamName: 'Category leader', teamLogoUrl: null, draftSlot: 3 },
      ],
      standings: ['member-1', 'member-2', 'member-3'].map((memberId) => ({
        id: `standing-${memberId}`,
        memberId,
        wins: 4,
        losses: 2,
        draws: 0,
        categoryWins: 20,
        categoryLosses: 10,
        categoryDraws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      })),
      tieBreakCategoryTotalByMemberId: new Map([
        ['member-1', 40],
        ['member-2', 40],
        ['member-3', 52],
      ]),
    });

    expect(standings.map((standing) => standing.memberId)).toEqual([
      'member-3',
      'member-2',
      'member-1',
    ]);
  });

  it('orders lower selected category totals first for LOW_WINS categories', () => {
    const standings = buildLeagueStandings({
      members: [
        { id: 'member-1', teamName: 'Higher total', teamLogoUrl: null, draftSlot: 1 },
        { id: 'member-2', teamName: 'Lower total', teamLogoUrl: null, draftSlot: 2 },
      ],
      standings: ['member-1', 'member-2'].map((memberId) => ({
        id: `standing-${memberId}`,
        memberId,
        wins: 4,
        losses: 2,
        draws: 0,
        categoryWins: 20,
        categoryLosses: 10,
        categoryDraws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      })),
      tieBreakCategoryTotalByMemberId: new Map([
        ['member-1', 18],
        ['member-2', 11],
      ]),
      tieBreakDirection: 'LOW_WINS',
    });

    expect(standings.map((standing) => standing.memberId)).toEqual(['member-2', 'member-1']);
  });
});
