import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
  assertLocalAflTradeFiveSeasonPostgresFactualCoverage,
  assertLocalAflTradeFiveSeasonPostgresStagingCoverage,
  assertLocalAflTradeFiveSeasonCoverage,
  createLocalAflTradeFiveSeasonCapturePlan,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonFitzRoyOutcomeLoad';

describe('local five-season fitzRoy outcome load', () => {
  it('plans one independently authorized AFL Tables capture for every completed season from 2021 through 2025', () => {
    const plan = createLocalAflTradeFiveSeasonCapturePlan();

    expect(LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(plan).toEqual([
      {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2021,
        parameters: { season: 2021, rescrape: false, rescrapeStartSeason: null },
      },
      {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2022,
        parameters: { season: 2022, rescrape: false, rescrapeStartSeason: null },
      },
      {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2023,
        parameters: { season: 2023, rescrape: false, rescrapeStartSeason: null },
      },
      {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2024,
        parameters: { season: 2024, rescrape: false, rescrapeStartSeason: null },
      },
      {
        schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        authorizationSeason: 2025,
        parameters: { season: 2025, rescrape: false, rescrapeStartSeason: null },
      },
    ]);
  });

  it('accepts complete season-specific capture coverage and rejects gaps, duplicates, or scope drift', () => {
    const completeCoverage = LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.map((season) => ({
      authorizationSeason: season,
      observedSeasonValues: [String(season)],
    }));

    expect(assertLocalAflTradeFiveSeasonCoverage(completeCoverage)).toEqual({
      seasons: [2021, 2022, 2023, 2024, 2025],
      captureCount: 5,
    });
    expect(() => assertLocalAflTradeFiveSeasonCoverage(completeCoverage.slice(1))).toThrow(
      /exactly one capture for each season from 2021 through 2025/
    );
    expect(() =>
      assertLocalAflTradeFiveSeasonCoverage([...completeCoverage, completeCoverage[4]!])
    ).toThrow(/exactly one capture for each season from 2021 through 2025/);
    expect(() =>
      assertLocalAflTradeFiveSeasonCoverage([
        ...completeCoverage.slice(0, 4),
        { authorizationSeason: 2025, observedSeasonValues: ['2024', '2025'] },
      ])
    ).toThrow(/capture season scope drifted/);
  });

  it('requires all five exact non-production captures to be finalized in PostgreSQL staging', async () => {
    const captures = LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.map((season) => ({
      authorizationSeason: season,
      observedSeasonValues: [String(season)],
      captureId: `source-capture:${String(season).padEnd(64, 'a')}`,
      normalizationRunId: `provider-normalization-run:${String(season).padEnd(64, 'b')}`,
    }));
    const stagedRows = captures.map((capture) => ({
      capture_id: capture.captureId,
      anchor_season_year: capture.authorizationSeason,
      environment: 'non_production',
      provider: 'afl_tables',
      capability_id: 'afl-tables-player-stats',
      normalization_run_id: capture.normalizationRunId,
      normalization_status: 'needs_review',
      finalized_at: new Date(`2026-08-14T00:0${capture.authorizationSeason - 2021}:00.000Z`),
      source_row_count: 100,
      staged_seasons: [capture.authorizationSeason],
    }));
    const queryRows = vi.fn(
      async (_sql: string, _values?: readonly unknown[]) => stagedRows as readonly unknown[]
    );
    const query = async <T>(
      sql: string,
      values?: readonly unknown[]
    ): Promise<{ rows: readonly T[] }> => ({
      rows: (await queryRows(sql, values)) as readonly T[],
    });

    await expect(
      assertLocalAflTradeFiveSeasonPostgresStagingCoverage({ query }, captures)
    ).resolves.toEqual({
      seasons: LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
      captureCount: 5,
      rowCount: 500,
    });
    expect(queryRows).toHaveBeenCalledWith(
      expect.stringContaining('outcome_provider_normalization_run'),
      [captures.map(({ captureId }) => captureId)]
    );

    queryRows.mockResolvedValueOnce([]);
    await expect(
      assertLocalAflTradeFiveSeasonPostgresStagingCoverage({ query }, captures)
    ).rejects.toThrow('exactly one finalized AFL Tables staging run');
  });

  it('requires each exact normalization run to produce appearance facts consumed by reconciliation', async () => {
    const captures = LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.map((season) => ({
      authorizationSeason: season,
      observedSeasonValues: [String(season)],
      captureId: `source-capture:${String(season).padEnd(64, 'a')}`,
      normalizationRunId: `provider-normalization-run:${String(season).padEnd(64, 'b')}`,
      factBatchId: `source-fact-batch:${String(season).padEnd(64, 'c')}`,
      factualRunId: `factual-reconciliation-run:${String(season).padEnd(64, 'd')}`,
    }));
    const factualRows = captures.map((capture) => ({
      normalization_run_id: capture.normalizationRunId,
      fact_batch_id: capture.factBatchId,
      fact_batch_status: 'approved',
      fact_batch_finalized_at: new Date('2026-08-14T01:00:00.000Z'),
      season_year: capture.authorizationSeason,
      appearance_fact_count: 100,
      factual_run_id: capture.factualRunId,
      factual_run_status: 'approved',
      factual_run_finalized_at: new Date('2026-08-14T01:01:00.000Z'),
      consumed_appearance_count: 100,
    }));
    const queryRows = vi.fn(
      async (_sql: string, _values?: readonly unknown[]) => factualRows as readonly unknown[]
    );
    const query = async <T>(
      sql: string,
      values?: readonly unknown[]
    ): Promise<{ rows: readonly T[] }> => ({
      rows: (await queryRows(sql, values)) as readonly T[],
    });

    await expect(
      assertLocalAflTradeFiveSeasonPostgresFactualCoverage({ query }, captures)
    ).resolves.toEqual({
      seasons: LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
      captureCount: 5,
      appearanceFactCount: 500,
    });
    expect(queryRows).toHaveBeenCalledWith(
      expect.stringContaining('outcome_factual_reconciliation_appearance_input'),
      [captures.map(({ normalizationRunId }) => normalizationRunId)]
    );

    queryRows.mockResolvedValueOnce([]);
    await expect(
      assertLocalAflTradeFiveSeasonPostgresFactualCoverage({ query }, captures)
    ).rejects.toThrow('appearance facts consumed by factual reconciliation');
  });
});
