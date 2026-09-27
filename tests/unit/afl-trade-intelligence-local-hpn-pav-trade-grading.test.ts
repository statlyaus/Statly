import { describe, expect, it } from 'vitest';

import {
  canonicalAflClub,
  gradeLocalHpnPavTrade,
  type LocalHpnPavSeasonView,
} from '@/server/aflTradeIntelligence/development/localHpnPavTradeGrading';

function view(
  players: Record<string, { name: string; teams: string[]; pav: number }>
): LocalHpnPavSeasonView {
  return {
    pav: new Map(Object.entries(players).map(([id, player]) => [id, player.pav])),
    players: new Map(
      Object.entries(players).map(([id, player]) => [
        id,
        { names: new Set([player.name]), teams: new Set(player.teams) },
      ])
    ),
  };
}

const playerLeg = (name: string, fromClub: string, toClub: string) => ({
  fromClub,
  toClub,
  assetKind: 'player',
  playerName: name,
});

// October 2025 trade: at-trade is the 2025 season, realized is 2026 at the receiving club.
const season2025 = view({
  'afl-tables:1': { name: 'Sam Swap', teams: ['Carlton'], pav: 12 },
  'afl-tables:2': { name: 'Joe Other', teams: ['Greater Western Sydney'], pav: 8 },
});
const season2026 = view({
  'afl-tables:1': { name: 'Sam Swap', teams: ['Greater Western Sydney'], pav: 15 },
  'afl-tables:2': { name: 'Joe Other', teams: ['Carlton'], pav: 5 },
});

describe('canonicalAflClub', () => {
  it('maps Draftguru and common variants onto AFL Tables spellings and rejects unknown names', () => {
    expect(canonicalAflClub('GWS Giants')).toBe('Greater Western Sydney');
    expect(canonicalAflClub('greater western sydney')).toBe('Greater Western Sydney');
    expect(canonicalAflClub('Sydney Swans')).toBe('Sydney');
    expect(canonicalAflClub('West Coast')).toBe('West Coast');
    expect(canonicalAflClub('Tasmania')).toBeNull();
  });
});

describe('gradeLocalHpnPavTrade', () => {
  it('grades a player-for-player swap as realized minus at-trade value per club', () => {
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-swap',
      legs: [
        playerLeg('Sam Swap', 'Carlton', 'GWS Giants'),
        playerLeg('Joe Other', 'GWS Giants', 'Carlton'),
      ],
      parseIssues: [],
      atTrade: season2025,
      realized: season2026,
    });

    expect(verdict.status).toBe('complete');
    const gws = verdict.clubs.find(({ club }) => club === 'Greater Western Sydney')!;
    // Receives Sam (12 -> 15), gives Joe (8 -> 5): at-trade +4, realized +10, grade +6.
    expect(gws).toEqual({
      club: 'Greater Western Sydney',
      atTradeNet: 4,
      realizedNet: 10,
      grade: 6,
    });
  });

  it('reports at-trade values but no grade when the realized season is not supplied', () => {
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-swap',
      legs: [playerLeg('Sam Swap', 'Carlton', 'GWS Giants')],
      parseIssues: [],
      atTrade: season2025,
      realized: null,
    });

    expect(verdict.status).toBe('complete');
    expect(
      verdict.clubs.every(({ grade, realizedNet }) => grade === null && realizedNet === null)
    ).toBe(true);
    expect(verdict.legs[0]!.atTradePav).toBe(12);
  });

  it.each([
    [
      'a pick leg',
      { fromClub: 'Carlton', toClub: 'GWS', assetKind: 'current_pick', playerName: null },
      /current_pick leg/,
    ],
    ['an unknown club', playerLeg('Sam Swap', 'Carlton', 'Tasmania'), /unknown club/],
    [
      'a player who never played for the giving club',
      playerLeg('Sam Swap', 'Hawthorn', 'Carlton'),
      /did not play for Hawthorn/,
    ],
  ])('marks a trade with %s incomplete and ungraded', (_label, leg, reason) => {
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-x',
      legs: [leg],
      parseIssues: [],
      atTrade: season2025,
      realized: season2026,
    });

    expect(verdict.status).toBe('incomplete');
    expect(verdict.reasons.join('; ')).toMatch(reason);
    expect(verdict.clubs.every(({ grade }) => grade === null)).toBe(true);
  });

  it('never guesses between same-name players at the giving club', () => {
    const ambiguous = view({
      'afl-tables:1': { name: 'Sam Swap', teams: ['Carlton'], pav: 12 },
      'afl-tables:9': { name: 'Sam Swap', teams: ['Carlton'], pav: 3 },
    });
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-x',
      legs: [playerLeg('Sam Swap', 'Carlton', 'GWS')],
      parseIssues: [],
      atTrade: ambiguous,
      realized: null,
    });

    expect(verdict.status).toBe('incomplete');
    expect(verdict.reasons).toEqual(['Sam Swap matches 2 players at Carlton']);
  });

  it('uses the giving club to tell apart same-name players at different clubs', () => {
    const sameName = view({
      'afl-tables:1': { name: 'Sam Swap', teams: ['Carlton'], pav: 12 },
      'afl-tables:9': { name: 'Sam Swap', teams: ['Essendon'], pav: 3 },
    });
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-x',
      legs: [playerLeg('Sam Swap', 'Essendon', 'GWS')],
      parseIssues: [],
      atTrade: sameName,
      realized: null,
    });

    expect(verdict.legs[0]).toMatchObject({ playerId: 'afl-tables:9', atTradePav: 3 });
  });

  it('refuses to credit realized value earned at a club other than the receiving one', () => {
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-x',
      legs: [playerLeg('Sam Swap', 'Carlton', 'Essendon')],
      parseIssues: [],
      atTrade: season2025,
      realized: season2026,
    });

    expect(verdict.status).toBe('incomplete');
    expect(verdict.reasons[0]).toMatch(/only for Essendon/);
  });

  it('carries parser issues into the verdict instead of grading around them', () => {
    const verdict = gradeLocalHpnPavTrade({
      tradeId: '2025-x',
      legs: [playerLeg('Sam Swap', 'Carlton', 'GWS')],
      parseIssues: ['unpaired_asset'],
      atTrade: season2025,
      realized: season2026,
    });

    expect(verdict).toMatchObject({
      status: 'incomplete',
      reasons: ['parse issue: unpaired_asset'],
    });
  });
});
