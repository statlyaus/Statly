import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queries: [] as Array<{ collection: string; filters: Array<[string, string, unknown]> }>,
  docs: {} as Record<string, unknown[]>,
  fail: null as string | null,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection(name: string) {
      const entry = { collection: name, filters: [] as Array<[string, string, unknown]> };
      state.queries.push(entry);
      const query = {
        where(field: string, op: string, value: unknown) {
          entry.filters.push([field, op, value]);
          return query;
        },
        get: async () => {
          if (state.fail === name) throw new Error(`${name} down`);
          return { docs: (state.docs[name] ?? []).map((row) => ({ data: () => row })) };
        },
      };
      return query;
    },
  },
}));

import { getLiveMatchDataResult } from './etlRoundData';

describe('getLiveMatchDataResult', () => {
  beforeEach(() => {
    state.queries = [];
    state.docs = {};
    state.fail = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reads the in-progress matches and only their player stats', async () => {
    state.docs.matches = [{ match_uid: 'm1' }, { match_uid: 'm2' }];
    state.docs.player_match_stats = [
      {
        player_uid: 'ply_a',
        match_uid: 'm1',
        player_name: 'A Player',
        team: 'Geelong',
        season: 2026,
        round: 7,
        data_source: 'footywire_fitzroy',
        last_updated: { toDate: () => new Date('2026-04-25T05:10:00.000Z') },
        stats: { goals: 2, tackles: null },
        raw_row: { secret: 'source row' },
        raw_checksum: 'abc',
      },
    ];

    const result = await getLiveMatchDataResult();

    expect(state.queries).toEqual([
      { collection: 'matches', filters: [['status', '==', 'in_progress']] },
      { collection: 'player_match_stats', filters: [['match_uid', 'in', ['m1', 'm2']]] },
    ]);
    // Only the fields the page shows leave the server: no raw source row, no checksum.
    expect(result).toEqual({
      ok: true,
      matches: state.docs.matches,
      stats: [
        {
          player_uid: 'ply_a',
          match_uid: 'm1',
          player_name: 'A Player',
          team: 'Geelong',
          season: 2026,
          round_number: 7,
          source: 'footywire_fitzroy',
          last_seen_at: '2026-04-25T05:10:00.000Z',
          stats: { goals: 2, tackles: null },
        },
      ],
    });
  });

  it('does not read player stats when no match is in progress', async () => {
    const result = await getLiveMatchDataResult();

    expect(state.queries.map((query) => query.collection)).toEqual(['matches']);
    expect(result).toEqual({ ok: true, matches: [], stats: [] });
  });

  it('fails closed when the stats read fails, instead of showing matches with no stats', async () => {
    state.docs.matches = [{ match_uid: 'm1' }];
    state.fail = 'player_match_stats';

    const result = await getLiveMatchDataResult();

    expect(result.ok).toBe(false);
  });
});
