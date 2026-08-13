import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';
import {
  aflTradeSourceFactBatchSchema,
  type AflTradeSourceFact,
  type AflTradeSourceFactBatch,
} from './factualObservationContracts';

export const AFL_TRADE_FACT_EXTRACTOR_VERSION =
  'afl-trade-factual-observation-extractor/v1' as const;

export interface AflTradeFactualObservationExecutionContext {
  environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradeSourceFactBatch {
  batchId: string;
  factCount: number;
  sourceRowCount: number;
  idempotentReplay: boolean;
  publicationEligible: false;
}

export class AflTradeFactualObservationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_BATCH'
      | 'ENVIRONMENT_MISMATCH'
      | 'STAGING_MISMATCH'
      | 'CANDIDATE_MISMATCH'
      | 'REPLAY_CONFLICT'
      | 'UNSUPPORTED_SCOPE'
      | 'PERSISTENCE_REJECTED',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFactualObservationPersistenceError';
  }
}

interface RunContextRow {
  normalization_run_id: string;
  capture_id: string;
  staging_sha256: string;
  source_row_count: number;
  issue_count: number;
  finalized_at: string | Date | null;
  field_map_sha256: string;
  environment: string;
  provider: string;
  capability_id: string | null;
  competition: string;
}

interface DecodedRowContext {
  provider_decoded_row_id: string;
  source_row_number: number;
  source_row_sha256: string;
  row_status: string;
  identity_candidate_sha256: string | null;
  match_candidate_sha256: string | null;
}

interface IssueContext {
  provider_decoded_row_id: string;
  issue_id: string;
  issue_code: string;
  source_field: string | null;
  details_json: unknown;
}

interface MetricCandidateContext {
  provider_decoded_row_id: string;
  metric_code: string;
  candidate_json: unknown;
}

interface AchievementCandidateContext {
  provider_decoded_row_id: string;
  achievement_candidate_id: string;
  candidate_json: unknown;
}

export class PostgresAflTradeFactualObservationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistBatch(
    input: unknown,
    execution: AflTradeFactualObservationExecutionContext
  ): Promise<PersistedAflTradeSourceFactBatch> {
    let batch: AflTradeSourceFactBatch;
    try {
      batch = aflTradeSourceFactBatchSchema.parse(input);
    } catch (error) {
      throw new AflTradeFactualObservationPersistenceError(
        'INVALID_BATCH',
        error instanceof Error ? error.message : 'The factual source batch is invalid.'
      );
    }
    if (!execution || execution.environment !== batch.content.environment) {
      throw new AflTradeFactualObservationPersistenceError(
        'ENVIRONMENT_MISMATCH',
        'The execution environment must equal the immutable factual batch environment.'
      );
    }

    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `provider-fact-batch:${batch.batchId}`,
        ]);
        const replay = await transaction.query<{ receipt_json: unknown }>(
          `SELECT receipt_json FROM outcome_provider_fact_batch WHERE fact_batch_id = $1`,
          [batch.batchId]
        );
        if (replay.rows[0]) {
          if (
            canonicalizeAflTradeJson(replay.rows[0].receipt_json) !==
            canonicalizeAflTradeJson(batch)
          ) {
            throw new AflTradeFactualObservationPersistenceError(
              'REPLAY_CONFLICT',
              'The fact-batch ID already exists with different immutable content.'
            );
          }
          return persistedResult(batch, true);
        }

        const context = await requireExactFinalizedStaging(transaction, batch);
        await insertOpenBatch(transaction, batch);
        await insertRowAccounting(transaction, batch);
        await insertAppearanceCandidates(transaction, batch);
        await insertFacts(transaction, batch);
        await insertIssueClosures(transaction, batch);
        await transaction.query(
          `UPDATE outcome_provider_fact_batch
              SET status = 'approved', completed_at = $2, finalized_at = $2, receipt_json = $3::jsonb
            WHERE fact_batch_id = $1 AND finalized_at IS NULL`,
          [batch.batchId, batch.content.createdAt, canonicalizeAflTradeJson(batch)]
        );
        const finalized = await transaction.query<{ finalized_at: string | Date | null }>(
          `SELECT finalized_at FROM outcome_provider_fact_batch WHERE fact_batch_id = $1`,
          [batch.batchId]
        );
        if (!finalized.rows[0]?.finalized_at || context.finalized_at === null) {
          throw new AflTradeFactualObservationPersistenceError(
            'PERSISTENCE_REJECTED',
            'The factual source batch did not finalize atomically.'
          );
        }
        return persistedResult(batch, false);
      });
    } catch (error) {
      if (error instanceof AflTradeFactualObservationPersistenceError) throw error;
      throw new AflTradeFactualObservationPersistenceError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the factual source batch.'
      );
    }
  }
}

function persistedResult(
  batch: AflTradeSourceFactBatch,
  idempotentReplay: boolean
): PersistedAflTradeSourceFactBatch {
  return {
    batchId: batch.batchId,
    factCount: batch.content.facts.length,
    sourceRowCount: batch.content.sourceRowCount,
    idempotentReplay,
    publicationEligible: false,
  };
}

async function requireExactFinalizedStaging(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch
): Promise<RunContextRow> {
  const run = await transaction.query<RunContextRow>(
    `SELECT r.normalization_run_id, r.capture_id, r.staging_sha256, r.source_row_count,
            r.issue_count, r.finalized_at, fm.field_map_sha256, c.environment, c.provider,
            c.capability_id, c.competition
       FROM outcome_provider_normalization_run r
       JOIN outcome_provider_field_map fm ON fm.field_map_id = r.field_map_id
       JOIN outcome_source_capture c ON c.capture_id = r.capture_id
      WHERE r.normalization_run_id = $1 AND r.capture_id = $2`,
    [batch.content.normalizationRunId, batch.content.captureId]
  );
  const context = run.rows[0];
  const finalizedAt = context?.finalized_at ? new Date(context.finalized_at).toISOString() : null;
  const expectedFinalization = createAflTradeContentAddress('provider-normalization-finalization', {
    normalizationRunId: batch.content.normalizationRunId,
    stagingSha256: context?.staging_sha256,
    finalizedAt,
  });
  if (
    !context ||
    finalizedAt === null ||
    finalizedAt !== batch.content.normalizationFinalizedAt ||
    context.staging_sha256 !== batch.content.stagingSha256 ||
    context.source_row_count !== batch.content.sourceRowCount ||
    context.issue_count !== batch.content.sourceIssueCount ||
    context.field_map_sha256 !== batch.content.fieldMapSha256 ||
    context.environment !== batch.content.environment ||
    context.provider !== batch.content.provider ||
    context.capability_id !== batch.content.capabilityId ||
    context.competition !== batch.content.competition ||
    batch.content.normalizationFinalization.id !== expectedFinalization
  ) {
    throw new AflTradeFactualObservationPersistenceError(
      'STAGING_MISMATCH',
      'The batch does not match one exact finalized normalization run.'
    );
  }

  const rows = await transaction.query<DecodedRowContext>(
    `SELECT r.provider_decoded_row_id, r.source_row_number, r.source_row_sha256, r.row_status,
            ic.candidate_sha256 AS identity_candidate_sha256,
            mc.candidate_sha256 AS match_candidate_sha256
       FROM outcome_provider_decoded_row r
       LEFT JOIN outcome_provider_identity_candidate ic ON ic.provider_decoded_row_id = r.provider_decoded_row_id
       LEFT JOIN outcome_provider_match_candidate mc ON mc.provider_decoded_row_id = r.provider_decoded_row_id
      WHERE r.normalization_run_id = $1
      ORDER BY r.provider_decoded_row_id`,
    [batch.content.normalizationRunId]
  );
  const ledger = batch.content.rowAccounting;
  if (
    rows.rows.length !== ledger.length ||
    rows.rows.some(
      (row, index) =>
        row.provider_decoded_row_id !== ledger[index]?.providerDecodedRowId ||
        row.source_row_sha256 !== ledger[index]?.sourceRowSha256
    ) ||
    sha256AflTradeCanonicalJson(
      rows.rows.map(({ provider_decoded_row_id, source_row_sha256 }) => ({
        providerDecodedRowId: provider_decoded_row_id,
        sourceRowSha256: source_row_sha256,
      }))
    ) !== batch.content.sourceRowSetSha256
  ) {
    throw new AflTradeFactualObservationPersistenceError(
      'STAGING_MISMATCH',
      'The batch row ledger is not the complete finalized normalization row set.'
    );
  }

  const issues = await transaction.query<IssueContext>(
    `SELECT r.provider_decoded_row_id, i.issue_id, i.issue_code, i.source_field, i.details_json
       FROM outcome_provider_normalization_issue i
       JOIN outcome_provider_decoded_row r
         ON r.normalization_run_id = i.normalization_run_id
        AND r.source_row_number = i.source_row_number
      WHERE i.normalization_run_id = $1
      ORDER BY r.provider_decoded_row_id, i.issue_id`,
    [batch.content.normalizationRunId]
  );
  const issuesByRow = new Map<string, IssueContext[]>();
  for (const issue of issues.rows) {
    const current = issuesByRow.get(issue.provider_decoded_row_id) ?? [];
    current.push(issue);
    issuesByRow.set(issue.provider_decoded_row_id, current);
  }
  for (const row of ledger) {
    const actual = issuesByRow.get(row.providerDecodedRowId) ?? [];
    const expectedIssueSet = createAflTradeContentAddress('provider-resolution-issue-set', {
      normalizationRunId: batch.content.normalizationRunId,
      providerDecodedRowId: row.providerDecodedRowId,
      issues: actual.map(({ issue_id, issue_code, source_field, details_json }) => ({
        issue_id,
        issue_code,
        source_field,
        details_json,
      })),
    });
    if (
      row.issueSet.id !== expectedIssueSet ||
      actual.length !== row.issueIds.length ||
      actual.some(({ issue_id }, index) => row.issueIds[index] !== issue_id) ||
      actual.some(({ issue_id }, index) => row.blockingIssueIds[index] !== issue_id)
    ) {
      throw new AflTradeFactualObservationPersistenceError(
        'STAGING_MISMATCH',
        'A row issue ledger does not match its exact immutable normalization issues.'
      );
    }
  }

  const metricCandidates = await transaction.query<MetricCandidateContext>(
    `SELECT m.provider_decoded_row_id, m.metric_code, m.candidate_json
       FROM outcome_provider_metric_candidate m
       JOIN outcome_provider_decoded_row r ON r.provider_decoded_row_id = m.provider_decoded_row_id
      WHERE r.normalization_run_id = $1`,
    [batch.content.normalizationRunId]
  );
  const achievements = await transaction.query<AchievementCandidateContext>(
    `SELECT a.provider_decoded_row_id, a.achievement_candidate_id, a.candidate_json
       FROM outcome_provider_achievement_candidate a
       JOIN outcome_provider_decoded_row r ON r.provider_decoded_row_id = a.provider_decoded_row_id
      WHERE r.normalization_run_id = $1`,
    [batch.content.normalizationRunId]
  );
  requireCandidateDigests(batch, rows.rows, metricCandidates.rows, achievements.rows);
  return context;
}

function requireCandidateDigests(
  batch: AflTradeSourceFactBatch,
  rows: readonly DecodedRowContext[],
  metrics: readonly MetricCandidateContext[],
  achievements: readonly AchievementCandidateContext[]
) {
  const rowsById = new Map(rows.map((row) => [row.provider_decoded_row_id, row]));
  const metricByKey = new Map(
    metrics.map((metric) => [
      `${metric.provider_decoded_row_id}:${metric.metric_code}`,
      sha256AflTradeCanonicalJson(metric.candidate_json),
    ])
  );
  const achievementById = new Map(
    achievements.map((achievement) => [
      achievement.achievement_candidate_id,
      sha256AflTradeCanonicalJson(achievement.candidate_json),
    ])
  );
  for (const fact of batch.content.facts) {
    const row = rowsById.get(fact.content.source.providerDecodedRowId);
    const digests = fact.content.source.candidateDigests;
    if (
      !row ||
      (digests.identity !== null && digests.identity !== row.identity_candidate_sha256) ||
      (digests.match !== null && digests.match !== row.match_candidate_sha256)
    ) {
      throw new AflTradeFactualObservationPersistenceError(
        'CANDIDATE_MISMATCH',
        'A source fact does not bind the exact staged identity and match candidates.'
      );
    }
    if (
      (fact.content.factKind === 'player_match_metric' ||
        fact.content.factKind === 'player_season_metric') &&
      digests.metric !==
        metricByKey.get(`${fact.content.source.providerDecodedRowId}:${fact.content.metricCode}`)
    ) {
      throw new AflTradeFactualObservationPersistenceError(
        'CANDIDATE_MISMATCH',
        'A metric fact does not bind the exact staged metric candidate.'
      );
    }
    if (
      fact.content.factKind === 'player_achievement' &&
      digests.achievement !== achievementById.get(fact.content.achievementCandidateId)
    ) {
      throw new AflTradeFactualObservationPersistenceError(
        'CANDIDATE_MISMATCH',
        'An achievement fact does not bind the exact staged achievement candidate.'
      );
    }
  }
}

async function insertOpenBatch(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch
) {
  const content = batch.content;
  await transaction.query(
    `INSERT INTO outcome_provider_fact_batch
      (fact_batch_id, normalization_run_id, capture_id, environment, provider, capability_id,
       competition, season_year, extractor_version, normalization_finalization_id,
       normalization_finalization_sha256, normalization_finalized_at, source_staging_sha256,
       source_row_set_sha256, source_issue_set_sha256, fact_batch_sha256, status,
       source_row_count, match_fact_count, appearance_fact_count, metric_fact_count,
       achievement_fact_count, issue_count, normalized_row_count, non_normalized_row_count,
       started_at, completed_at, finalized_at, receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'staged',
             $17,$18,$19,$20,$21,$22,$23,$24,$25,NULL,NULL,$26::jsonb)`,
    [
      batch.batchId,
      content.normalizationRunId,
      content.captureId,
      content.environment,
      content.provider,
      content.capabilityId,
      content.competition,
      content.seasonYear,
      AFL_TRADE_FACT_EXTRACTOR_VERSION,
      content.normalizationFinalization.id,
      content.normalizationFinalization.sha256,
      content.normalizationFinalizedAt,
      content.stagingSha256,
      content.sourceRowSetSha256,
      content.sourceIssueSetSha256,
      batch.batchSha256,
      content.sourceRowCount,
      content.counts.matchUniverse,
      content.counts.playerAppearances,
      content.counts.playerMatchMetrics + content.counts.playerSeasonMetrics,
      content.counts.playerAchievements,
      content.sourceIssueCount,
      content.counts.normalizedRows,
      content.counts.nonNormalizedRows,
      content.createdAt,
      canonicalizeAflTradeJson(batch),
    ]
  );
}

async function insertRowAccounting(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch
) {
  for (const row of batch.content.rowAccounting) {
    await transaction.query(
      `INSERT INTO outcome_provider_fact_row_accounting
        (fact_batch_id, provider_decoded_row_id, source_row_sha256, disposition, fact_count,
         issue_count, blocking_issue_count, issue_set_id, issue_set_sha256, reason_code,
         accounting_sha256, accounting_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        batch.batchId,
        row.providerDecodedRowId,
        row.sourceRowSha256,
        row.disposition,
        row.factIds.length,
        row.issueIds.length,
        row.blockingIssueIds.length,
        row.issueSet.id,
        row.issueSet.sha256,
        row.reasonCode,
        sha256AflTradeCanonicalJson(row),
        canonicalizeAflTradeJson(row),
      ]
    );
  }
}

async function insertAppearanceCandidates(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch
) {
  const candidates = new Map<string, AflTradeSourceFact>();
  for (const fact of batch.content.facts) {
    if (fact.content.factKind === 'player_appearance') {
      candidates.set(fact.content.appearanceCandidate.candidateId, fact);
    }
  }
  for (const fact of candidates.values()) {
    if (fact.content.factKind !== 'player_appearance') continue;
    const candidate = fact.content.appearanceCandidate;
    await transaction.query(
      `INSERT INTO outcome_provider_appearance_candidate
        (appearance_candidate_id, provider_decoded_row_id, observed, candidate_sha256,
         candidate_digests_json, candidate_json)
       VALUES ($1,$2,TRUE,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT (appearance_candidate_id) DO NOTHING`,
      [
        candidate.candidateId,
        candidate.content.providerDecodedRowId,
        candidate.candidateSha256,
        canonicalizeAflTradeJson({
          identity: candidate.content.identityCandidateSha256,
          match: candidate.content.matchCandidateSha256,
        }),
        canonicalizeAflTradeJson(candidate.content),
      ]
    );
  }
}

async function insertFacts(transaction: AflOutcomeSqlTransaction, batch: AflTradeSourceFactBatch) {
  for (const fact of batch.content.facts) {
    switch (fact.content.factKind) {
      case 'match_universe':
        await insertMatchFact(transaction, batch, fact);
        break;
      case 'player_appearance':
        await insertAppearanceFact(transaction, batch, fact);
        break;
      case 'player_match_metric':
      case 'player_season_metric':
        await insertMetricFact(transaction, batch, fact);
        break;
      case 'player_achievement':
        await insertAchievementFact(transaction, batch, fact);
        break;
    }
  }
}

async function insertMatchFact(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch,
  fact: AflTradeSourceFact
) {
  if (fact.content.factKind !== 'match_universe') throw new Error('Unexpected fact kind.');
  const content = fact.content;
  const completion = content.completion;
  await transaction.query(
    `INSERT INTO outcome_provider_match_universe_fact
      (match_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,match_candidate_id,
       match_resolution_decision_id,match_assignment_decision_id,match_identity_id,match_id,
       competition,season_year,availability,completion_state,reason_code,effective_at,recorded_at,
       candidate_sha256,candidate_digests_json,fact_sha256,fact_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20::jsonb)`,
    [
      fact.factId,
      batch.batchId,
      content.source.normalizationRunId,
      content.source.providerDecodedRowId,
      content.matchCandidateId,
      content.match.decision.id,
      content.match.assignment.decisionId,
      content.match.matchIdentityId,
      content.match.matchId,
      content.competition,
      content.seasonYear,
      completion.state === 'quarantined' ? 'quarantined' : 'measured',
      completion.state === 'completed'
        ? 'completed'
        : completion.state === 'not_completed'
          ? completion.reasonCode
          : 'unknown',
      completion.state === 'quarantined' ? completion.reasonCode : null,
      content.effectiveAt,
      content.recordedAt,
      content.source.candidateDigests.match,
      canonicalizeAflTradeJson(content.source.candidateDigests),
      fact.factSha256,
      canonicalizeAflTradeJson(content),
    ]
  );
}

async function insertAppearanceFact(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch,
  fact: AflTradeSourceFact
) {
  if (fact.content.factKind !== 'player_appearance') throw new Error('Unexpected fact kind.');
  const content = fact.content;
  await transaction.query(
    `INSERT INTO outcome_provider_player_appearance_fact
      (appearance_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
       appearance_candidate_id,identity_candidate_id,match_candidate_id,
       player_resolution_decision_id,player_assignment_decision_id,match_resolution_decision_id,
       match_assignment_decision_id,represented_club_resolution_decision_id,
       represented_club_assignment_decision_id,player_identity_id,match_identity_id,
       represented_club_identity_id,player_id,match_id,represented_club_id,competition,season_year,
       availability,appeared,reason_code,effective_at,recorded_at,candidate_sha256,
       candidate_digests_json,fact_sha256,fact_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
             'measured',TRUE,NULL,$22,$23,$24,$25::jsonb,$26,$27::jsonb)`,
    [
      fact.factId,
      batch.batchId,
      content.source.normalizationRunId,
      content.source.providerDecodedRowId,
      content.appearanceCandidate.candidateId,
      content.player.identityCandidateId,
      content.match.matchCandidateId,
      content.player.decision.id,
      content.player.assignment.decisionId,
      content.match.decision.id,
      content.match.assignment.decisionId,
      content.representedClub.decision.id,
      content.representedClub.assignment.decisionId,
      content.player.playerIdentityId,
      content.match.matchIdentityId,
      content.representedClub.clubIdentityId,
      content.player.playerId,
      content.match.matchId,
      content.representedClub.clubId,
      content.competition,
      content.seasonYear,
      content.effectiveAt,
      content.recordedAt,
      content.source.candidateDigests.appearance,
      canonicalizeAflTradeJson(content.source.candidateDigests),
      fact.factSha256,
      canonicalizeAflTradeJson(content),
    ]
  );
}

function clubScopeColumns(
  content: Extract<
    AflTradeSourceFact['content'],
    { factKind: 'player_season_metric' | 'player_achievement' }
  >
) {
  const scope = content.seasonClubScope;
  if (scope.kind === 'reviewed_unattributed') {
    return [scope.kind, null, null, null, null, scope.decision.id, scope.reasonCode] as const;
  }
  return [
    scope.kind,
    scope.club.decision.id,
    scope.club.assignment.decisionId,
    scope.club.clubIdentityId,
    scope.club.clubId,
    null,
    null,
  ] as const;
}

async function insertMetricFact(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch,
  fact: AflTradeSourceFact
) {
  if (
    fact.content.factKind !== 'player_match_metric' &&
    fact.content.factKind !== 'player_season_metric'
  ) {
    throw new Error('Unexpected fact kind.');
  }
  const content = fact.content;
  const isMatch = content.factKind === 'player_match_metric';
  const scope = isMatch
    ? (['appearance_fact', null, null, null, null, null, null] as const)
    : clubScopeColumns(content);
  if (scope[0] === 'reviewed_unattributed') {
    throw new AflTradeFactualObservationPersistenceError(
      'UNSUPPORTED_SCOPE',
      'Reviewed-unattributed season club scope requires retained governed evidence before persistence.'
    );
  }
  await transaction.query(
    `INSERT INTO outcome_provider_numeric_metric_fact
      (metric_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,appearance_fact_id,
       identity_candidate_id,player_resolution_decision_id,player_assignment_decision_id,
       player_identity_id,player_id,match_id,club_scope_kind,club_resolution_decision_id,
       club_assignment_decision_id,club_identity_id,club_id,club_scope_decision_id,
       club_scope_reason_code,competition,season_year,grain,metric_code,definition_version,
       availability,numeric_value,unit,reason_code,effective_at,recorded_at,candidate_sha256,
       candidate_digests_json,fact_sha256,fact_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
             $22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32,$33::jsonb)`,
    [
      fact.factId,
      batch.batchId,
      content.source.normalizationRunId,
      content.source.providerDecodedRowId,
      isMatch ? content.appearanceFactId : null,
      content.player.identityCandidateId,
      content.player.decision.id,
      content.player.assignment.decisionId,
      content.player.playerIdentityId,
      content.player.playerId,
      isMatch ? content.match.matchId : null,
      ...scope,
      content.competition,
      content.seasonYear,
      isMatch ? 'match' : 'season',
      content.metricCode,
      content.definitionVersion,
      content.availability.state,
      content.availability.numericValue,
      content.unit,
      content.availability.reasonCode,
      content.effectiveAt,
      content.recordedAt,
      content.source.candidateDigests.metric,
      canonicalizeAflTradeJson(content.source.candidateDigests),
      fact.factSha256,
      canonicalizeAflTradeJson(content),
    ]
  );
}

async function insertAchievementFact(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch,
  fact: AflTradeSourceFact
) {
  if (fact.content.factKind !== 'player_achievement') throw new Error('Unexpected fact kind.');
  const content = fact.content;
  const scope = clubScopeColumns(content);
  if (scope[0] === 'reviewed_unattributed') {
    throw new AflTradeFactualObservationPersistenceError(
      'UNSUPPORTED_SCOPE',
      'Reviewed-unattributed achievement scope requires retained governed evidence before persistence.'
    );
  }
  await transaction.query(
    `INSERT INTO outcome_provider_achievement_fact
      (achievement_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
       achievement_candidate_id,identity_candidate_id,player_resolution_decision_id,
       player_assignment_decision_id,player_identity_id,player_id,club_scope_kind,
       club_resolution_decision_id,club_assignment_decision_id,club_identity_id,club_id,
       club_scope_decision_id,club_scope_reason_code,competition,season_year,achievement_code,
       availability,evidence_value,reason_code,effective_at,recorded_at,candidate_sha256,
       candidate_digests_json,fact_sha256,fact_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29::jsonb)`,
    [
      fact.factId,
      batch.batchId,
      content.source.normalizationRunId,
      content.source.providerDecodedRowId,
      content.achievementCandidateId,
      content.player.identityCandidateId,
      content.player.decision.id,
      content.player.assignment.decisionId,
      content.player.playerIdentityId,
      content.player.playerId,
      ...scope,
      content.competition,
      content.seasonYear,
      content.achievementCode,
      content.availability.state === 'affirmed' ? 'measured' : content.availability.state,
      content.availability.evidenceValue,
      content.availability.reasonCode,
      content.effectiveAt,
      content.recordedAt,
      content.source.candidateDigests.achievement,
      canonicalizeAflTradeJson(content.source.candidateDigests),
      fact.factSha256,
      canonicalizeAflTradeJson(content),
    ]
  );
}

async function insertIssueClosures(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeSourceFactBatch
) {
  for (const row of batch.content.rowAccounting) {
    for (const closure of row.blockingIssueClosures) {
      await transaction.query(
        `INSERT INTO outcome_provider_fact_issue_closure
          (fact_batch_id,provider_decoded_row_id,issue_id,closure_decision_id,closure_decision_sha256)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          batch.batchId,
          row.providerDecodedRowId,
          closure.issueId,
          closure.decision.id,
          closure.decision.sha256,
        ]
      );
    }
  }
}
