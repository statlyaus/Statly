import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';
import {
  aflTradeAcquisitionSpellMetricBatchSchema,
  aflTradeAcquisitionSpellMetricPolicySchema,
  type AflTradeAcquisitionSpellMetricBatch,
  type AflTradeAcquisitionSpellMetricPolicy,
} from './acquisitionSpellMetricContracts';

export interface AflTradeAcquisitionSpellMetricExecutionContext {
  environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradeAcquisitionSpellMetricBatch {
  batchId: string;
  metricCount: number;
  idempotentReplay: boolean;
  publicationEligible: false;
}

export class AflTradeAcquisitionSpellMetricPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_POLICY'
      | 'INVALID_BATCH'
      | 'ENVIRONMENT_MISMATCH'
      | 'POLICY_MISMATCH'
      | 'SPELL_MISMATCH'
      | 'REPLAY_CONFLICT'
      | 'STALE_REVISION'
      | 'PERSISTENCE_REJECTED',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeAcquisitionSpellMetricPersistenceError';
  }
}

interface StoredPolicyRow {
  policy_sha256: string;
  policy_json: unknown;
  environment: string;
  competition: string;
  valid_from_season: number;
  valid_through_season: number;
  status: string;
}

interface StoredSpellRow {
  spell_version_id: string;
  spell_id: string;
  version: number;
  player_id: string;
  club_id: string;
  start_event_version_id: string;
  start_asset_version_id: string;
  start_date: string | Date;
  end_date: string | Date | null;
  rule_id: string;
  status: string;
  recorded_at: string | Date;
}

export class PostgresAflTradeAcquisitionSpellMetricRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistPolicy(input: unknown, execution: AflTradeAcquisitionSpellMetricExecutionContext) {
    let policy: AflTradeAcquisitionSpellMetricPolicy;
    try {
      policy = aflTradeAcquisitionSpellMetricPolicySchema.parse(input);
    } catch (error) {
      throw new AflTradeAcquisitionSpellMetricPersistenceError(
        'INVALID_POLICY',
        error instanceof Error ? error.message : 'The spell-metric policy is invalid.'
      );
    }
    requireEnvironment(policy.content.environment, execution);
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `acquisition-spell-metric-policy:${policy.policyId}`,
        ]);
        const replay = await transaction.query<StoredPolicyRow>(
          `SELECT policy_sha256,policy_json,environment,competition,valid_from_season,
                  valid_through_season,status
             FROM outcome_acquisition_spell_metric_policy WHERE policy_id=$1`,
          [policy.policyId]
        );
        if (replay.rows[0]) {
          requireStoredPolicy(replay.rows[0], policy, 'REPLAY_CONFLICT');
          return { policyId: policy.policyId, idempotentReplay: true, publicationEligible: false };
        }
        await transaction.query(
          `INSERT INTO outcome_acquisition_spell_metric_policy
            (policy_id,policy_version,environment,competition,valid_from_season,valid_through_season,
             policy_sha256,approval_decision_id,status,policy_json,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9::jsonb,$10)`,
          [
            policy.policyId,
            policy.content.policyVersion,
            policy.content.environment,
            policy.content.competition,
            policy.content.validFromSeason,
            policy.content.validThroughSeason,
            policy.policySha256,
            policy.content.approval.id,
            canonicalizeAflTradeJson(policy.content),
            policy.content.createdAt,
          ]
        );
        return { policyId: policy.policyId, idempotentReplay: false, publicationEligible: false };
      });
    } catch (error) {
      if (error instanceof AflTradeAcquisitionSpellMetricPersistenceError) throw error;
      throw rejected(error, 'PostgreSQL rejected the spell-metric policy.');
    }
  }

  async persistBatch(
    input: unknown,
    execution: AflTradeAcquisitionSpellMetricExecutionContext
  ): Promise<PersistedAflTradeAcquisitionSpellMetricBatch> {
    let batch: AflTradeAcquisitionSpellMetricBatch;
    try {
      batch = aflTradeAcquisitionSpellMetricBatchSchema.parse(input);
    } catch (error) {
      throw new AflTradeAcquisitionSpellMetricPersistenceError(
        'INVALID_BATCH',
        error instanceof Error ? error.message : 'The acquisition-spell metric batch is invalid.'
      );
    }
    requireEnvironment(batch.content.policy.content.environment, execution);
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `acquisition-spell-metric-batch:${batch.batchId}`,
        ]);
        const replay = await transaction.query<{ receipt_json: unknown }>(
          `SELECT receipt_json FROM outcome_acquisition_spell_metric_batch WHERE batch_id=$1`,
          [batch.batchId]
        );
        if (replay.rows[0]) {
          if (
            canonicalizeAflTradeJson(replay.rows[0].receipt_json) !==
            canonicalizeAflTradeJson(batch)
          ) {
            throw new AflTradeAcquisitionSpellMetricPersistenceError(
              'REPLAY_CONFLICT',
              'The spell-metric batch ID already exists with different immutable content.'
            );
          }
          return persistedBatch(batch, true);
        }
        await requireExactPolicy(transaction, batch.content.policy);
        await requireExactSpell(transaction, batch);
        await insertOpenBatch(transaction, batch);
        await insertMetricVersions(transaction, batch);
        await advanceHeads(transaction, batch);
        await transaction.query(
          `UPDATE outcome_acquisition_spell_metric_batch
              SET status='approved',finalized_at=$2,receipt_json=$3::jsonb
            WHERE batch_id=$1 AND finalized_at IS NULL`,
          [batch.batchId, batch.content.recordedAt, canonicalizeAflTradeJson(batch)]
        );
        const finalized = await transaction.query<{ finalized_at: string | Date | null }>(
          `SELECT finalized_at FROM outcome_acquisition_spell_metric_batch WHERE batch_id=$1`,
          [batch.batchId]
        );
        if (!finalized.rows[0]?.finalized_at) {
          throw new AflTradeAcquisitionSpellMetricPersistenceError(
            'PERSISTENCE_REJECTED',
            'The spell-metric batch did not finalize atomically.'
          );
        }
        return persistedBatch(batch, false);
      });
    } catch (error) {
      if (error instanceof AflTradeAcquisitionSpellMetricPersistenceError) throw error;
      throw rejected(error, 'PostgreSQL rejected the spell-metric batch.');
    }
  }
}

function requireEnvironment(
  expected: string,
  execution: AflTradeAcquisitionSpellMetricExecutionContext
) {
  if (!execution || execution.environment !== expected) {
    throw new AflTradeAcquisitionSpellMetricPersistenceError(
      'ENVIRONMENT_MISMATCH',
      'Execution environment must equal the immutable spell-metric environment.'
    );
  }
}

function requireStoredPolicy(
  stored: StoredPolicyRow,
  policy: AflTradeAcquisitionSpellMetricPolicy,
  code: 'POLICY_MISMATCH' | 'REPLAY_CONFLICT'
) {
  if (
    stored.policy_sha256 !== policy.policySha256 ||
    canonicalizeAflTradeJson(stored.policy_json) !== canonicalizeAflTradeJson(policy.content) ||
    stored.environment !== policy.content.environment ||
    stored.competition !== policy.content.competition ||
    stored.valid_from_season !== policy.content.validFromSeason ||
    stored.valid_through_season !== policy.content.validThroughSeason ||
    stored.status !== 'approved'
  ) {
    throw new AflTradeAcquisitionSpellMetricPersistenceError(
      code,
      'The retained spell-metric policy does not match the exact approved content.'
    );
  }
}

async function requireExactPolicy(
  transaction: AflOutcomeSqlTransaction,
  policy: AflTradeAcquisitionSpellMetricPolicy
) {
  const stored = await transaction.query<StoredPolicyRow>(
    `SELECT policy_sha256,policy_json,environment,competition,valid_from_season,
            valid_through_season,status
       FROM outcome_acquisition_spell_metric_policy WHERE policy_id=$1`,
    [policy.policyId]
  );
  if (!stored.rows[0]) {
    throw new AflTradeAcquisitionSpellMetricPersistenceError(
      'POLICY_MISMATCH',
      'The exact approved spell-metric policy has not been retained.'
    );
  }
  requireStoredPolicy(stored.rows[0], policy, 'POLICY_MISMATCH');
}

function canonicalDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

async function requireExactSpell(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeAcquisitionSpellMetricBatch
) {
  const stored = await transaction.query<StoredSpellRow>(
    `SELECT spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
            start_asset_version_id,start_date,end_date,rule_id,status,recorded_at
       FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
    [batch.content.spell.spellVersionId]
  );
  const row = stored.rows[0];
  const spell = batch.content.spell;
  if (
    !row ||
    row.spell_id !== spell.spellId ||
    row.version !== spell.version ||
    row.player_id !== spell.playerId ||
    row.club_id !== spell.clubId ||
    row.start_event_version_id !== spell.startEventVersionId ||
    row.start_asset_version_id !== spell.startAssetVersionId ||
    canonicalDate(row.start_date) !== spell.startDate ||
    canonicalDate(row.end_date) !== spell.endDate ||
    row.rule_id !== spell.rule.id ||
    row.status !== 'approved' ||
    new Date(row.recorded_at).toISOString() !== spell.recordedAt
  ) {
    throw new AflTradeAcquisitionSpellMetricPersistenceError(
      'SPELL_MISMATCH',
      'The batch does not match the exact approved acquisition-spell version.'
    );
  }
}

async function insertOpenBatch(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeAcquisitionSpellMetricBatch
) {
  const content = batch.content;
  await transaction.query(
    `INSERT INTO outcome_acquisition_spell_metric_batch
      (batch_id,batch_sha256,policy_id,spell_version_id,environment,competition,status,
       metric_count,recorded_at,finalized_at,receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,'staged',$7,$8,NULL,$9::jsonb)`,
    [
      batch.batchId,
      batch.batchSha256,
      content.policy.policyId,
      content.spell.spellVersionId,
      content.policy.content.environment,
      content.policy.content.competition,
      content.metrics.length,
      content.recordedAt,
      canonicalizeAflTradeJson(batch),
    ]
  );
}

async function insertMetricVersions(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeAcquisitionSpellMetricBatch
) {
  const advanceByVersion = new Map(
    batch.content.headAdvances.map((advance) => [advance.spellMetricVersionId, advance])
  );
  for (const metric of batch.content.metrics) {
    const content = metric.content;
    const advance = advanceByVersion.get(metric.spellMetricVersionId);
    if (!advance) {
      throw new AflTradeAcquisitionSpellMetricPersistenceError(
        'INVALID_BATCH',
        'Every spell metric requires one exact head advance.'
      );
    }
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_metric_version
        (spell_metric_version_id,batch_id,spell_version_id,metric_code,definition_version,state,
         numeric_value,reason_code,coverage_numerator,coverage_denominator,observation_count,
         effective_through,fact_sha256,fact_json,recorded_at,expected_head_revision,head_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`,
      [
        metric.spellMetricVersionId,
        batch.batchId,
        content.spell.spellVersionId,
        content.rule.metricCode,
        content.rule.definitionVersion,
        content.availability.state,
        content.availability.numericValue,
        content.availability.reasonCode,
        content.coverageNumerator,
        content.coverageDenominator,
        content.observationCount,
        content.effectiveThrough,
        metric.factSha256,
        canonicalizeAflTradeJson(content),
        content.recordedAt,
        advance.expectedRevision,
        advance.nextRevision,
      ]
    );
    for (const [index, member] of content.members.entries()) {
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_metric_version_member
          (spell_metric_version_id,reconciled_fact_id,factual_run_id,ordinal,subject_key,
           head_revision,finalization_id,finalization_sha256,membership_sha256,membership_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          metric.spellMetricVersionId,
          member.result.reconciledFactId,
          member.factualRunId,
          index + 1,
          member.subjectKey,
          member.headRevision,
          member.finalization.id,
          member.finalization.sha256,
          sha256AflTradeCanonicalJson(member),
          canonicalizeAflTradeJson(member),
        ]
      );
    }
  }
}

async function advanceHeads(
  transaction: AflOutcomeSqlTransaction,
  batch: AflTradeAcquisitionSpellMetricBatch
) {
  for (const advance of batch.content.headAdvances) {
    const metric = batch.content.metrics.find(
      ({ spellMetricVersionId }) => spellMetricVersionId === advance.spellMetricVersionId
    );
    if (!metric) {
      throw new AflTradeAcquisitionSpellMetricPersistenceError(
        'INVALID_BATCH',
        'A spell-metric head cannot reference a version outside its batch.'
      );
    }
    const persisted = await transaction.query(
      `INSERT INTO outcome_acquisition_spell_metric_head
        (subject_key,revision,spell_metric_version_id,updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (subject_key) DO UPDATE
         SET revision=EXCLUDED.revision,spell_metric_version_id=EXCLUDED.spell_metric_version_id,
             updated_at=EXCLUDED.updated_at
       WHERE outcome_acquisition_spell_metric_head.revision=$5`,
      [
        advance.subjectKey,
        advance.nextRevision,
        advance.spellMetricVersionId,
        metric.content.recordedAt,
        advance.expectedRevision,
      ]
    );
    if (persisted.rowCount !== 1) {
      throw new AflTradeAcquisitionSpellMetricPersistenceError(
        'STALE_REVISION',
        `The current spell metric changed before ${advance.subjectKey} could advance.`
      );
    }
  }
}

function persistedBatch(
  batch: AflTradeAcquisitionSpellMetricBatch,
  idempotentReplay: boolean
): PersistedAflTradeAcquisitionSpellMetricBatch {
  return {
    batchId: batch.batchId,
    metricCount: batch.content.metrics.length,
    idempotentReplay,
    publicationEligible: false,
  };
}

function rejected(error: unknown, fallback: string) {
  return new AflTradeAcquisitionSpellMetricPersistenceError(
    'PERSISTENCE_REJECTED',
    error instanceof Error ? error.message : fallback
  );
}
