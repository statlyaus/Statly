import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  parseAflTradeFitzRoyCaptureRequest,
  type AflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';

export const LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW = [2021, 2022, 2023, 2024, 2025] as const;

export interface LocalAflTradeSeasonCaptureCoverage {
  authorizationSeason: number;
  observedSeasonValues: readonly string[];
}

export interface LocalAflTradeFiveSeasonCoverageReceipt {
  seasons: typeof LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW;
  captureCount: number;
}

export interface LocalAflTradeFiveSeasonStagedCapture
  extends LocalAflTradeSeasonCaptureCoverage {
  captureId: string;
  normalizationRunId: string;
}

export interface LocalAflTradeFiveSeasonPostgresStagingReceipt
  extends LocalAflTradeFiveSeasonCoverageReceipt {
  rowCount: number;
}

export interface LocalAflTradeFiveSeasonReconciledCapture
  extends LocalAflTradeFiveSeasonStagedCapture {
  factBatchId: string;
  factualRunId: string;
}

export interface LocalAflTradeFiveSeasonPostgresFactualReceipt
  extends LocalAflTradeFiveSeasonCoverageReceipt {
  appearanceFactCount: number;
}

interface LocalAflTradeFiveSeasonSqlClient {
  query<T>(sql: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }>;
}

interface LocalAflTradeFiveSeasonStagingRow {
  capture_id: string;
  anchor_season_year: number;
  environment: string;
  provider: string;
  capability_id: string | null;
  normalization_run_id: string;
  normalization_status: string;
  finalized_at: Date | string | null;
  source_row_count: number;
  staged_seasons: number[];
}

interface LocalAflTradeFiveSeasonFactualRow {
  normalization_run_id: string;
  fact_batch_id: string;
  fact_batch_status: string;
  fact_batch_finalized_at: Date | string | null;
  season_year: number;
  appearance_fact_count: number;
  factual_run_id: string;
  factual_run_status: string;
  factual_run_finalized_at: Date | string | null;
  consumed_appearance_count: number;
}

export function createLocalAflTradeFiveSeasonCapturePlan(): AflTradeFitzRoyCaptureRequest[] {
  return LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.map((season) =>
    parseAflTradeFitzRoyCaptureRequest({
      schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      authorizationSeason: season,
      parameters: {
        season,
        rescrape: false,
        rescrapeStartSeason: null,
      },
    })
  );
}

export function assertLocalAflTradeFiveSeasonCoverage(
  captures: readonly LocalAflTradeSeasonCaptureCoverage[]
): LocalAflTradeFiveSeasonCoverageReceipt {
  const expectedSeasons = new Set<number>(LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW);
  const capturedSeasons = captures.map(({ authorizationSeason }) => authorizationSeason);
  const uniqueCapturedSeasons = new Set(capturedSeasons);

  if (
    captures.length !== LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.length ||
    uniqueCapturedSeasons.size !== LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW.length ||
    capturedSeasons.some((season) => !expectedSeasons.has(season))
  ) {
    throw new TypeError(
      'The local outcome load requires exactly one capture for each season from 2021 through 2025.'
    );
  }

  for (const capture of captures) {
    if (
      capture.observedSeasonValues.length !== 1 ||
      capture.observedSeasonValues[0] !== String(capture.authorizationSeason)
    ) {
      throw new TypeError(
        `The season ${capture.authorizationSeason} capture season scope drifted from its authorization.`
      );
    }
  }

  return {
    seasons: LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
    captureCount: captures.length,
  };
}

export async function assertLocalAflTradeFiveSeasonPostgresStagingCoverage(
  client: LocalAflTradeFiveSeasonSqlClient,
  captures: readonly LocalAflTradeFiveSeasonStagedCapture[]
): Promise<LocalAflTradeFiveSeasonPostgresStagingReceipt> {
  const coverage = assertLocalAflTradeFiveSeasonCoverage(captures);
  if (
    captures.some(
      ({ captureId, normalizationRunId }) =>
        !/^source-capture:[a-f0-9]{64}$/.test(captureId) ||
        !/^provider-normalization-run:[a-f0-9]{64}$/.test(normalizationRunId)
    ) ||
    new Set(captures.map(({ captureId }) => captureId)).size !== captures.length ||
    new Set(captures.map(({ normalizationRunId }) => normalizationRunId)).size !== captures.length
  ) {
    throw new TypeError(
      'Five-season PostgreSQL staging requires unique content-addressed capture and normalization identities.'
    );
  }

  const captureIds = captures.map(({ captureId }) => captureId);
  const persisted = await client.query<LocalAflTradeFiveSeasonStagingRow>(
    `SELECT capture.capture_id,
            capture.anchor_season_year,
            capture.environment::text AS environment,
            capture.provider,
            capture.capability_id,
            run.normalization_run_id,
            run.status::text AS normalization_status,
            run.finalized_at,
            run.source_row_count,
            array_agg(DISTINCT row.season_year ORDER BY row.season_year) AS staged_seasons
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run ON run.capture_id=capture.capture_id
       JOIN outcome_provider_decoded_row row
         ON row.capture_id=capture.capture_id
        AND row.normalization_run_id=run.normalization_run_id
      WHERE capture.capture_id=ANY($1::text[])
      GROUP BY capture.capture_id,capture.anchor_season_year,capture.environment,
               capture.provider,capture.capability_id,run.normalization_run_id,run.status,
               run.finalized_at,run.source_row_count
      ORDER BY capture.anchor_season_year`,
    [captureIds]
  );

  if (persisted.rows.length !== captures.length) {
    throw new TypeError(
      'Each local season requires exactly one finalized AFL Tables staging run in PostgreSQL.'
    );
  }
  let rowCount = 0;
  for (const capture of captures) {
    const row = persisted.rows.find(({ capture_id }) => capture_id === capture.captureId);
    if (
      row === undefined ||
      row.anchor_season_year !== capture.authorizationSeason ||
      row.environment !== 'non_production' ||
      row.provider !== 'afl_tables' ||
      row.capability_id !== 'afl-tables-player-stats' ||
      row.normalization_run_id !== capture.normalizationRunId ||
      row.normalization_status !== 'needs_review' ||
      row.finalized_at === null ||
      !Number.isSafeInteger(row.source_row_count) ||
      row.source_row_count <= 0 ||
      row.staged_seasons.length !== 1 ||
      row.staged_seasons[0] !== capture.authorizationSeason
    ) {
      throw new TypeError(
        `The season ${capture.authorizationSeason} PostgreSQL staging boundary is incomplete or mismatched.`
      );
    }
    rowCount += row.source_row_count;
  }
  return { ...coverage, rowCount };
}

export async function assertLocalAflTradeFiveSeasonPostgresFactualCoverage(
  client: LocalAflTradeFiveSeasonSqlClient,
  captures: readonly LocalAflTradeFiveSeasonReconciledCapture[]
): Promise<LocalAflTradeFiveSeasonPostgresFactualReceipt> {
  const coverage = assertLocalAflTradeFiveSeasonCoverage(captures);
  if (
    captures.some(
      ({ normalizationRunId, factBatchId, factualRunId }) =>
        !/^provider-normalization-run:[a-f0-9]{64}$/.test(normalizationRunId) ||
        !/^source-fact-batch:[a-f0-9]{64}$/.test(factBatchId) ||
        !/^factual-reconciliation-run:[a-f0-9]{64}$/.test(factualRunId)
    ) ||
    new Set(captures.map(({ normalizationRunId }) => normalizationRunId)).size !==
      captures.length ||
    new Set(captures.map(({ factBatchId }) => factBatchId)).size !== captures.length ||
    new Set(captures.map(({ factualRunId }) => factualRunId)).size !== captures.length
  ) {
    throw new TypeError(
      'Five-season factual coverage requires unique content-addressed normalization, fact-batch, and reconciliation identities.'
    );
  }

  const normalizationRunIds = captures.map(({ normalizationRunId }) => normalizationRunId);
  const persisted = await client.query<LocalAflTradeFiveSeasonFactualRow>(
    `SELECT batch.normalization_run_id,
            batch.fact_batch_id,
            batch.status::text AS fact_batch_status,
            batch.finalized_at AS fact_batch_finalized_at,
            batch.season_year,
            batch.appearance_fact_count,
            run.factual_run_id,
            run.status::text AS factual_run_status,
            run.finalized_at AS factual_run_finalized_at,
            count(DISTINCT input.appearance_fact_id)::integer AS consumed_appearance_count
       FROM outcome_provider_fact_batch batch
       JOIN outcome_provider_player_appearance_fact appearance
         ON appearance.fact_batch_id=batch.fact_batch_id
        AND appearance.normalization_run_id=batch.normalization_run_id
       JOIN outcome_factual_reconciliation_appearance_input input
         ON input.appearance_fact_id=appearance.appearance_fact_id
       JOIN outcome_factual_reconciliation_run run
         ON run.factual_run_id=input.factual_run_id
      WHERE batch.normalization_run_id=ANY($1::text[])
      GROUP BY batch.normalization_run_id,batch.fact_batch_id,batch.status,batch.finalized_at,
               batch.season_year,batch.appearance_fact_count,run.factual_run_id,run.status,
               run.finalized_at
      ORDER BY batch.season_year,run.factual_run_id`,
    [normalizationRunIds]
  );

  let appearanceFactCount = 0;
  for (const capture of captures) {
    const row = persisted.rows.find(
      (candidate) =>
        candidate.normalization_run_id === capture.normalizationRunId &&
        candidate.fact_batch_id === capture.factBatchId &&
        candidate.factual_run_id === capture.factualRunId
    );
    if (
      row === undefined ||
      row.season_year !== capture.authorizationSeason ||
      row.fact_batch_status !== 'approved' ||
      row.fact_batch_finalized_at === null ||
      row.factual_run_status !== 'approved' ||
      row.factual_run_finalized_at === null ||
      !Number.isSafeInteger(row.appearance_fact_count) ||
      row.appearance_fact_count <= 0 ||
      row.consumed_appearance_count !== row.appearance_fact_count
    ) {
      throw new TypeError(
        `The season ${capture.authorizationSeason} requires exact appearance facts consumed by factual reconciliation.`
      );
    }
    appearanceFactCount += row.appearance_fact_count;
  }

  return { ...coverage, appearanceFactCount };
}
