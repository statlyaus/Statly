import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeAchievementReconciliationPolicySchema,
  aflTradeAchievementReconciliationRunSchema,
  type AflTradeAchievementReconciliationPolicy,
  type AflTradeAchievementReconciliationRun,
} from './achievementReconciliationContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

export type AflTradeAchievementReconciliationRepositoryErrorCode =
  'INVALID_POLICY' | 'INVALID_RUN' | 'CONFLICTING_REPLAY' | 'STALE_HEAD' | 'PERSISTENCE_FAILED';

export class AflTradeAchievementReconciliationRepositoryError extends Error {
  constructor(
    readonly code: AflTradeAchievementReconciliationRepositoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeAchievementReconciliationRepositoryError';
  }
}

export interface PersistedAflTradeAchievementRun {
  achievementRunId: string;
  idempotentReplay: boolean;
  finalizedAt: string;
}

interface ExistingRunRow {
  run_sha256: string;
  receipt_json: unknown;
  finalized_at: Date | string | null;
  status: string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function fail(code: AflTradeAchievementReconciliationRepositoryErrorCode, message: string): never {
  throw new AflTradeAchievementReconciliationRepositoryError(code, message);
}

async function requireExactPolicy(
  transaction: AflOutcomeSqlTransaction,
  policy: AflTradeAchievementReconciliationPolicy
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_achievement_reconciliation_policy
      (policy_id,policy_version,environment,competition,valid_from_season,valid_through_season,
       policy_sha256,approval_decision_id,status,policy_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9::jsonb,$10)
     ON CONFLICT (policy_id) DO NOTHING`,
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
      policy.content.approvedAt,
    ]
  );
  const exact = await transaction.query(
    `SELECT policy_id FROM outcome_achievement_reconciliation_policy
      WHERE policy_id=$1 AND policy_sha256=$2 AND environment=$3::"OutcomeEnvironment"
        AND competition=$4 AND policy_json=$5::jsonb AND status='approved'`,
    [
      policy.policyId,
      policy.policySha256,
      policy.content.environment,
      policy.content.competition,
      canonicalizeAflTradeJson(policy.content),
    ]
  );
  if (exact.rows.length !== 1)
    fail('INVALID_POLICY', 'Stored achievement policy conflicts with input.');
}

async function findReplay(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeAchievementReconciliationRun
): Promise<PersistedAflTradeAchievementRun | null> {
  const result = await transaction.query<ExistingRunRow>(
    `SELECT run_sha256,receipt_json,finalized_at,status
       FROM outcome_achievement_reconciliation_run
      WHERE achievement_run_id=$1
      FOR KEY SHARE`,
    [run.achievementRunId]
  );
  if (result.rows.length === 0) return null;
  const stored = result.rows[0];
  if (
    stored.run_sha256 !== run.runSha256 ||
    canonicalizeAflTradeJson(stored.receipt_json) !== canonicalizeAflTradeJson(run) ||
    stored.finalized_at === null ||
    stored.status !== 'approved'
  ) {
    fail('CONFLICTING_REPLAY', 'Achievement run identifier conflicts with stored evidence.');
  }
  return {
    achievementRunId: run.achievementRunId,
    idempotentReplay: true,
    finalizedAt: asIso(stored.finalized_at),
  };
}

async function insertOpenRun(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeAchievementReconciliationRun
) {
  const content = run.content;
  await transaction.query(
    `INSERT INTO outcome_achievement_reconciliation_run
      (achievement_run_id,policy_id,environment,competition,season_year,source_set_sha256,
       result_set_sha256,run_sha256,status,source_fact_count,result_count,conflict_count,
       started_at,completed_at,finalized_at,receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'staged',$9,$10,$11,$12,$13,NULL,$14::jsonb)`,
    [
      run.achievementRunId,
      content.policyId,
      content.environment,
      content.competition,
      content.seasonYear,
      content.sourceSetSha256,
      content.resultSetSha256,
      run.runSha256,
      content.counts.sourceFacts,
      content.counts.results,
      content.counts.conflicting,
      content.startedAt,
      content.completedAt,
      canonicalizeAflTradeJson(run),
    ]
  );
}

async function insertInputs(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeAchievementReconciliationRun
) {
  for (const membership of run.content.sourceMemberships) {
    await transaction.query(
      `INSERT INTO outcome_achievement_reconciliation_input
        (achievement_run_id,achievement_fact_id,ordinal,membership_sha256,membership_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        run.achievementRunId,
        membership.fact.factId,
        membership.ordinal,
        membership.factSha256,
        canonicalizeAflTradeJson(membership),
      ]
    );
  }
}

function resultHead(run: AflTradeAchievementReconciliationRun, resultId: string) {
  const head = run.content.headAdvances.find(
    ({ reconciledAchievementId }) => reconciledAchievementId === resultId
  );
  if (!head) fail('INVALID_RUN', 'Reconciled achievement has no exact current-head advance.');
  return head;
}

async function insertResult(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeAchievementReconciliationRun,
  result: AflTradeAchievementReconciliationRun['content']['results'][number]
) {
  const content = result.content;
  const head = resultHead(run, result.reconciledAchievementId);
  const clubId =
    content.clubScope.kind === 'resolved_single_club' ? content.clubScope.clubId : null;
  const clubReason =
    content.clubScope.kind === 'reviewed_unattributed' ? content.clubScope.reasonCode : null;
  const roundLabel = content.grain.kind === 'round' ? content.grain.roundLabel : null;
  const availability = content.availability;
  await transaction.query(
    `INSERT INTO outcome_reconciled_achievement
      (reconciled_achievement_id,achievement_run_id,player_id,club_scope_kind,club_id,
       club_scope_reason_code,competition,season_year,achievement_code,achievement_definition_id,
       grain_kind,round_label,state,evidence_value,reason_code,effective_at,effective_through,
       fact_sha256,fact_json,recorded_at,expected_head_revision,head_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22)`,
    [
      result.reconciledAchievementId,
      run.achievementRunId,
      content.playerId,
      content.clubScope.kind,
      clubId,
      clubReason,
      content.competition,
      content.seasonYear,
      content.achievementCode,
      content.definition.id,
      content.grain.kind,
      roundLabel,
      availability.state,
      availability.evidenceValue,
      availability.reasonCode,
      content.effectiveAt,
      content.effectiveThrough,
      result.factSha256,
      canonicalizeAflTradeJson(content),
      content.recordedAt,
      head.expectedRevision,
      head.revision,
    ]
  );
  const selected = new Set(availability.selectedSourceFactIds);
  for (const [index, factId] of availability.inputSourceFactIds.entries()) {
    const membership = run.content.sourceMemberships.find(({ fact }) => fact.factId === factId);
    if (!membership)
      fail('INVALID_RUN', 'Achievement result references an absent source membership.');
    const memberContent = { ...membership, selected: selected.has(factId) };
    await transaction.query(
      `INSERT INTO outcome_reconciled_achievement_member
        (achievement_run_id,reconciled_achievement_id,achievement_fact_id,ordinal,selected,
         membership_sha256,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        run.achievementRunId,
        result.reconciledAchievementId,
        factId,
        index + 1,
        selected.has(factId),
        membership.factSha256,
        canonicalizeAflTradeJson(memberContent),
      ]
    );
  }
  const advanced = await transaction.query(
    `INSERT INTO outcome_reconciled_achievement_head
      (subject_key,revision,reconciled_achievement_id,updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (subject_key) DO UPDATE SET
       revision=EXCLUDED.revision,
       reconciled_achievement_id=EXCLUDED.reconciled_achievement_id,
       updated_at=EXCLUDED.updated_at
     WHERE outcome_reconciled_achievement_head.revision=$5`,
    [
      head.subjectKey,
      head.revision,
      result.reconciledAchievementId,
      content.recordedAt,
      head.expectedRevision,
    ]
  );
  if (advanced.rowCount !== 1) fail('STALE_HEAD', 'Achievement current-head revision is stale.');
}

async function finalizeRun(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeAchievementReconciliationRun
): Promise<PersistedAflTradeAchievementRun> {
  const finalized = await transaction.query<{ finalized_at: Date | string }>(
    `UPDATE outcome_achievement_reconciliation_run
        SET status='approved',finalized_at=$2,receipt_json=$3::jsonb
      WHERE achievement_run_id=$1 AND finalized_at IS NULL
      RETURNING finalized_at`,
    [run.achievementRunId, run.content.completedAt, canonicalizeAflTradeJson(run)]
  );
  if (finalized.rows.length !== 1)
    fail('PERSISTENCE_FAILED', 'Achievement run did not finalize once.');
  return {
    achievementRunId: run.achievementRunId,
    idempotentReplay: false,
    finalizedAt: asIso(finalized.rows[0].finalized_at),
  };
}

export class PostgresAflTradeAchievementReconciliationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistPolicy(input: unknown): Promise<AflTradeAchievementReconciliationPolicy> {
    const parsed = aflTradeAchievementReconciliationPolicySchema.safeParse(input);
    if (!parsed.success) fail('INVALID_POLICY', parsed.error.message);
    try {
      await this.client.transaction(async (transaction) =>
        requireExactPolicy(transaction, parsed.data)
      );
      return parsed.data;
    } catch (error) {
      if (error instanceof AflTradeAchievementReconciliationRepositoryError) throw error;
      fail(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'Policy persistence failed.'
      );
    }
  }

  async persistRun(input: unknown): Promise<PersistedAflTradeAchievementRun> {
    const parsed = aflTradeAchievementReconciliationRunSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_RUN', parsed.error.message);
    try {
      return await this.client.transaction(async (transaction) => {
        const replay = await findReplay(transaction, parsed.data);
        if (replay) return replay;
        await insertOpenRun(transaction, parsed.data);
        await insertInputs(transaction, parsed.data);
        for (const result of parsed.data.content.results) {
          await insertResult(transaction, parsed.data, result);
        }
        return finalizeRun(transaction, parsed.data);
      });
    } catch (error) {
      if (error instanceof AflTradeAchievementReconciliationRepositoryError) throw error;
      fail(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'Run persistence failed.'
      );
    }
  }
}
