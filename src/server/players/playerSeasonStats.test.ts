import { describe, expect, it, vi } from 'vitest';

import {
  aggregatePlayerSeasonStats,
  replacePlayerSeasonStats,
  toEtlSeasonStatRow,
  type EtlSeasonStatRow,
  type PlayerSeasonStatInput,
} from './playerSeasonStats';

const row = (overrides: Partial<EtlSeasonStatRow>): EtlSeasonStatRow => ({
  matchUid: '2026-R1-CAR-RIC',
  playerUid: 'ply_sam_walsh',
  playerName: 'Sam Walsh',
  team: 'Carlton',
  season: 2026,
  round: 1,
  stats: { goals: 1, tackles: 4, disposal_efficiency: 80 },
  ...overrides,
});

describe('toEtlSeasonStatRow', () => {
  it('reads a player_match_stats document as the ETL writes it', () => {
    expect(
      toEtlSeasonStatRow('2026-R1-CAR-RIC_ply_sam_walsh', {
        match_uid: '2026-R1-CAR-RIC',
        player_uid: 'ply_sam_walsh',
        player_name: 'Sam Walsh',
        team: 'Carlton',
        season: 2026,
        round: 1,
        stats: { goals: 1, tackles: null, kicks: Number.NaN },
        raw_row: { ignored: true },
      })
    ).toEqual(row({ stats: { goals: 1, tackles: null, kicks: null } }));
  });

  it('fails closed on a document without its match, player, season or round', () => {
    const doc = { match_uid: 'm', player_uid: 'p', season: 2026, round: 1, stats: {} };
    expect(() => toEtlSeasonStatRow('d1', { ...doc, match_uid: '' })).toThrow('d1');
    expect(() => toEtlSeasonStatRow('d2', { ...doc, player_uid: undefined })).toThrow('d2');
    expect(() => toEtlSeasonStatRow('d3', { ...doc, season: '2026x' })).toThrow('d3');
    expect(() => toEtlSeasonStatRow('d4', { ...doc, round: undefined })).toThrow('d4');
    expect(() => toEtlSeasonStatRow('d5', { ...doc, round: null })).toThrow('d5');
  });
});

describe('aggregatePlayerSeasonStats', () => {
  const links = new Map([['ply_sam_walsh', 'player-walsh']]);

  it('sums each stat over the games that reported it, keyed on the canonical player id', () => {
    const result = aggregatePlayerSeasonStats(
      2026,
      [
        row({}),
        row({
          matchUid: '2026-R2-CAR-GEE',
          round: 2,
          stats: { goals: 2, tackles: null, disposal_efficiency: 70 },
        }),
      ],
      links
    );

    expect(result.unlinked).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.rows).toEqual([
      {
        playerId: 'player-walsh',
        season: 2026,
        club: 'Carlton',
        games: 2,
        lastRound: 2,
        totals: { goals: 3, tackles: 4, disposal_efficiency: 150 },
        gamesByStat: { goals: 2, tackles: 1, disposal_efficiency: 2 },
      },
    ]);
  });

  it('counts a repeated match document once', () => {
    const result = aggregatePlayerSeasonStats(
      2026,
      [row({ matchUid: '2026-R3-CAR-GCS', round: 3 }), row({}), row({})],
      links
    );

    expect(result.rows[0]).toMatchObject({ games: 2, lastRound: 3 });
    expect(result.rows[0].totals.goals).toBe(2);
  });

  it('reports rows without a reviewed link instead of guessing a player', () => {
    const result = aggregatePlayerSeasonStats(
      2026,
      [
        row({}),
        row({ playerUid: 'ply_new_rookie', playerName: 'New Rookie', team: 'Richmond' }),
        row({
          playerUid: 'ply_new_rookie',
          playerName: 'New Rookie',
          team: 'Richmond',
          matchUid: 'm2',
          round: 2,
        }),
      ],
      links
    );

    expect(result.rows.map((r) => r.playerId)).toEqual(['player-walsh']);
    expect(result.unlinked).toEqual([
      { externalId: 'ply_new_rookie', name: 'New Rookie', club: 'Richmond', games: 2 },
    ]);
  });

  it('leaves out an id seen at two clubs: namesakes share a Footywire id', () => {
    const result = aggregatePlayerSeasonStats(
      2026,
      [
        row({}),
        row({ matchUid: '2026-R1-GEE-HAW', team: 'Hawthorn', stats: { goals: 5 } }),
        row({ playerUid: 'ply_new_rookie', playerName: 'New Rookie' }),
        row({ playerUid: 'ply_new_rookie', playerName: 'New Rookie', team: 'Sydney' }),
      ],
      links
    );

    expect(result.rows).toEqual([]);
    expect(result.unlinked).toEqual([]);
    expect(result.ambiguous).toEqual([
      { externalId: 'ply_new_rookie', name: 'New Rookie', clubs: ['Carlton', 'Sydney'] },
      { externalId: 'ply_sam_walsh', name: 'Sam Walsh', clubs: ['Carlton', 'Hawthorn'] },
    ]);
  });

  it('fails when two Footywire ids link to one player: reviewed links never do that', () => {
    expect(() =>
      aggregatePlayerSeasonStats(
        2026,
        [row({}), row({ playerUid: 'ply_samuel_walsh', matchUid: 'm2', round: 2 })],
        new Map([...links, ['ply_samuel_walsh', 'player-walsh']])
      )
    ).toThrow('player-walsh has two Footywire ids');
  });

  it('ignores rows from another season and non-numeric stat values', () => {
    const result = aggregatePlayerSeasonStats(
      2026,
      [
        row({ season: 2025, team: 'Hawthorn' }),
        row({ stats: { goals: 'x' as unknown as number, tackles: 3 } }),
      ],
      links
    );

    expect(result.ambiguous).toEqual([]);
    expect(result.rows[0]).toMatchObject({ games: 1, totals: { tackles: 3 } });
    expect(result.rows[0].totals).not.toHaveProperty('goals');
  });
});

describe('replacePlayerSeasonStats', () => {
  const walsh: PlayerSeasonStatInput = {
    playerId: 'player-walsh',
    season: 2026,
    club: 'Carlton',
    games: 1,
    lastRound: 1,
    totals: { goals: 1 },
    gamesByStat: { goals: 1 },
  };

  it('replaces the whole season in one transaction', async () => {
    const tx = {
      playerSeasonStat: {
        deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const client = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const calculatedAt = new Date('2026-11-20T00:00:00Z');

    const result = await replacePlayerSeasonStats(client as never, 2026, [walsh], calculatedAt);

    expect(tx.playerSeasonStat.deleteMany).toHaveBeenCalledWith({ where: { season: 2026 } });
    expect(tx.playerSeasonStat.createMany).toHaveBeenCalledWith({
      data: [
        {
          playerId: 'player-walsh',
          season: 2026,
          club: 'Carlton',
          games: 1,
          lastRound: 1,
          totalsJson: { goals: 1 },
          gamesByStatJson: { goals: 1 },
          source: 'footywire',
          calculatedAt,
        },
      ],
    });
    expect(result).toEqual({ deleted: 5, created: 1 });
  });

  it('refuses rows for a different season', async () => {
    const client = { $transaction: vi.fn() };
    await expect(
      replacePlayerSeasonStats(client as never, 2026, [{ ...walsh, season: 2025 }])
    ).rejects.toThrow('2025');
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to replace a season with nothing', async () => {
    const client = { $transaction: vi.fn() };
    await expect(replacePlayerSeasonStats(client as never, 2026, [])).rejects.toThrow(
      'No linked player'
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
