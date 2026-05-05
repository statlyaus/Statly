import { describe, expect, it, vi } from 'vitest';

import {
  buildMatchLogStageSnapshot,
  MATCH_LOG_RECONCILIATION_STAT_KEYS,
} from '../src/lib/matchLogs';
import type { CanonicalStatKey } from '../src/lib/stats/statColumns';

vi.mock('../src/lib/aflSeason', () => ({
  getDefaultAflSeason: () => 2026,
}));

import {
  parseVerifyPlayerReadModelsArgs,
  resolveVerifierRounds,
  runVerifyPlayerReadModels,
  timedVerifierStage,
  type VerifyStageRow,
} from '../Scripts/verify-player-read-models-core';

function emptyTotals(): Record<CanonicalStatKey, number> {
  return Object.fromEntries(
    MATCH_LOG_RECONCILIATION_STAT_KEYS.map((key) => [key, 0])
  ) as Record<CanonicalStatKey, number>;
}

function stage(disposals: number) {
  return buildMatchLogStageSnapshot(
    { disposals },
    {
      availability: { disposals: true },
      provenance: { disposals: 'fitzroy_merged' },
    }
  );
}

function row(overrides: Partial<VerifyStageRow> = {}): VerifyStageRow {
  return {
    entityKey: 'match|2026_r0_gws_bul|player|joseph_fonti',
    matchId: '2026-R0-GWS-BUL',
    season: 2026,
    roundNumber: 0,
    playerId: 'joseph_fonti',
    playerName: 'Joseph Fonti',
    opponent: 'Western Bulldogs',
    stage: stage(10),
    ...overrides,
  };
}

describe('parseVerifyPlayerReadModelsArgs', () => {
  it('defaults to deterministic persisted verification', () => {
    expect(parseVerifyPlayerReadModelsArgs(['--season=2026'])).toMatchObject({
      season: 2026,
      rounds: [],
      playerId: null,
      mode: 'persisted',
      dataSource: 'afltables,footywire_match',
      mergedTimeoutMs: 120000,
    });
  });

  it('parses explicit live merged-source verification', () => {
    expect(
      parseVerifyPlayerReadModelsArgs([
        '--season=2026',
        '--rounds=0,1',
        '--player-id=joseph_fonti',
        '--include-merged-live',
        '--data-source=afltables,footywire_match',
        '--merged-timeout-ms=240000',
        '--json',
        '--trace',
      ])
    ).toMatchObject({
      season: 2026,
      rounds: [0, 1],
      playerId: 'joseph_fonti',
      mode: 'merged_live',
      dataSource: 'afltables,footywire_match',
      mergedTimeoutMs: 240000,
      json: true,
      trace: true,
    });
  });

  it('parses npm script style flag values separated by spaces', () => {
    expect(
      parseVerifyPlayerReadModelsArgs([
        '--season',
        '2026',
        '--rounds',
        '0,1',
        '--player-id',
        'joseph_fonti',
        '--merged-timeout-ms',
        '240000',
      ])
    ).toMatchObject({
      season: 2026,
      rounds: [0, 1],
      playerId: 'joseph_fonti',
      mergedTimeoutMs: 240000,
    });
  });
});

describe('resolveVerifierRounds', () => {
  it('uses requested rounds as the authoritative verification boundary', () => {
    expect(
      resolveVerifierRounds({
        requestedRounds: [1, 0, 1],
        rawRounds: [0, 1, 2],
        projectionRounds: [0, 1, 2],
      })
    ).toEqual([0, 1]);
  });
});

describe('timedVerifierStage', () => {
  it('records successful stage timing', async () => {
    const timings = [];
    const value = await timedVerifierStage({
      label: 'load_raw',
      trace: false,
      timings,
      run: async () => 42,
    });

    expect(value).toBe(42);
    expect(timings).toMatchObject([{ label: 'load_raw', status: 'ok' }]);
  });
});

describe('runVerifyPlayerReadModels', () => {
  it('does not fetch merged source rows in persisted mode', async () => {
    const loadMergedRows = vi.fn().mockResolvedValue([]);
    const output = await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0']),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [
          {
            playerId: 'joseph_fonti',
            playerName: 'Joseph Fonti',
            season: 2026,
            gamesPlayed: 1,
            totals: { ...emptyTotals(), disposals: 10 },
          },
        ],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows,
      }
    );

    expect(loadMergedRows).not.toHaveBeenCalled();
    expect(output.sourceStatus.merged).toBe('not_requested');
    expect(output.aggregateCheck.status).toBe('skipped');
    expect(output.status).toBe('pass');
  });

  it('calls merged loader only in live mode with scoped rounds', async () => {
    const loadMergedRows = vi.fn().mockResolvedValue([row()]);
    await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0,1', '--include-merged-live']),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows,
      }
    );

    expect(loadMergedRows).toHaveBeenCalledWith({
      season: 2026,
      rounds: [0, 1],
      dataSource: 'afltables,footywire_match',
      timeoutMs: 120000,
      trace: false,
    });
  });

  it('reports aggregate mismatches against raw totals', async () => {
    const output = await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs(['--season=2026']),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [
          {
            playerId: 'joseph_fonti',
            playerName: 'Joseph Fonti',
            season: 2026,
            gamesPlayed: 1,
            totals: { ...emptyTotals(), disposals: 11 },
          },
        ],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows: async () => [],
      }
    );

    expect(output.aggregateMismatchPlayers).toBe(1);
    expect(output.sampleAggregateMismatchPlayers).toEqual(['joseph_fonti']);
    expect(output.aggregateMismatchesByStat.disposals).toBe(1);
  });

  it('skips season-summary aggregate comparison for bounded round verification', async () => {
    const output = await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0']),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [
          {
            playerId: 'joseph_fonti',
            playerName: 'Joseph Fonti',
            season: 2026,
            gamesPlayed: 1,
            totals: { ...emptyTotals(), disposals: 11 },
          },
        ],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows: async () => [],
      }
    );

    expect(output.aggregateCheck).toMatchObject({ status: 'skipped' });
    expect(output.aggregateMismatchPlayers).toBe(0);
    expect(output.aggregateMismatchesByStat.disposals).toBe(0);
    expect(output.status).toBe('pass');
  });

  it('classifies live source timeout separately from persisted verification', async () => {
    const output = await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs([
        '--season=2026',
        '--rounds=0',
        '--include-merged-live',
      ]),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows: async () => {
          throw new Error('load_merged_source_rows timed out after 120000ms');
        },
      }
    );

    expect(output.sourceStatus.merged).toBe('timeout');
    expect(output.status).toBe('warn');
  });
});
