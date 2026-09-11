import { createHash, randomUUID } from 'node:crypto';

import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';
import {
  aflTradeFactualReconciliationPolicySchema,
  aflTradeFactualReconciliationRunSchema,
  type AflTradeFactualReconciliationPolicy,
  type AflTradeFactualReconciliationRun,
} from './factualReconciliationContracts';

export interface AflTradeFactualReconciliationExecutionContext {
  environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradeFactualReconciliationPolicy {
  policyId: string;
  idempotentReplay: boolean;
  publicationEligible: false;
}

export interface PersistedAflTradeFactualReconciliationRun {
  factualRunId: string;
  sourceFactCount: number;
  reconciledFactCount: number;
  conflictCount: number;
  idempotentReplay: boolean;
  publicationEligible: false;
}

export class AflTradeFactualReconciliationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_POLICY'
      | 'INVALID_RUN'
      | 'ENVIRONMENT_MISMATCH'
      | 'POLICY_MISMATCH'
      | 'REPLAY_CONFLICT'
      | 'STALE_REVISION'
      | 'PERSISTENCE_REJECTED',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFactualReconciliationPersistenceError';
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

export class PostgresAflTradeFactualReconciliationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistPolicy(
    input: unknown,
    execution: AflTradeFactualReconciliationExecutionContext
  ): Promise<PersistedAflTradeFactualReconciliationPolicy> {
    let policy: AflTradeFactualReconciliationPolicy;
    try {
      policy = aflTradeFactualReconciliationPolicySchema.parse(input);
    } catch (error) {
      throw new AflTradeFactualReconciliationPersistenceError(
        'INVALID_POLICY',
        error instanceof Error ? error.message : 'The factual reconciliation policy is invalid.'
      );
    }
    requireEnvironment(policy.content.environment, execution);
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `factual-reconciliation-policy:${policy.policyId}`,
        ]);
        const replay = await transaction.query<StoredPolicyRow>(
          `SELECT policy_sha256, policy_json, environment, competition, valid_from_season,
                  valid_through_season, status
             FROM outcome_factual_reconciliation_policy WHERE policy_id = $1`,
          [policy.policyId]
        );
        if (replay.rows[0]) {
          requireStoredPolicy(replay.rows[0], policy);
          return persistedPolicy(policy, true);
        }
        await transaction.query(
          `INSERT INTO outcome_factual_reconciliation_policy
            (policy_id,policy_version,environment,competition,valid_from_season,
             valid_through_season,policy_sha256,approval_decision_id,status,policy_json,created_at)
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
        return persistedPolicy(policy, false);
      });
    } catch (error) {
      if (error instanceof AflTradeFactualReconciliationPersistenceError) throw error;
      throw new AflTradeFactualReconciliationPersistenceError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the reconciliation policy.'
      );
    }
  }

  async persistRun(
    input: unknown,
    execution: AflTradeFactualReconciliationExecutionContext
  ): Promise<PersistedAflTradeFactualReconciliationRun> {
    let run: AflTradeFactualReconciliationRun;
    try {
      run = aflTradeFactualReconciliationRunSchema.parse(input);
    } catch (error) {
      throw new AflTradeFactualReconciliationPersistenceError(
        'INVALID_RUN',
        error instanceof Error ? error.message : 'The factual reconciliation run is invalid.'
      );
    }
    requireEnvironment(run.content.environment, execution);
    const receiptCanonicalJson = canonicalizeAflTradeJson(run);
    const receiptCanonicalSha256 = createHash('sha256')
      .update(receiptCanonicalJson, 'utf8')
      .digest('hex');
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `factual-reconciliation-run:${run.factualRunId}`,
        ]);
        const stagedReceiptTable = await stageCanonicalReceipt(transaction, receiptCanonicalJson);
        const replay = await transaction.query<{
          receipt_json: unknown;
          receipt_is_text: boolean;
          receipt_representation_valid: boolean;
          receipt_text_matches: boolean | null;
          status: string;
          finalized_at: string | Date | null;
        }>(
          `SELECT CASE WHEN receipt_canonical_json IS NULL THEN receipt_json ELSE NULL END AS receipt_json,
                  receipt_canonical_json IS NOT NULL AS receipt_is_text,
                  ((receipt_json IS NOT NULL AND receipt_canonical_json IS NULL AND receipt_canonical_sha256 IS NULL)
                   OR (receipt_json IS NULL AND receipt_canonical_json IS NOT NULL AND receipt_canonical_sha256 IS NOT NULL))
                    AS receipt_representation_valid,
                  (receipt_canonical_json = (SELECT receipt FROM pg_temp.${stagedReceiptTable})
                   AND receipt_canonical_sha256 = $2) AS receipt_text_matches,
                  status, finalized_at
             FROM outcome_factual_reconciliation_run WHERE factual_run_id = $1`,
          [run.factualRunId, receiptCanonicalSha256]
        );
        if (replay.rows[0]) {
          const receipt = replay.rows[0];
          if (
            receipt.status !== 'approved' ||
            receipt.finalized_at === null ||
            receipt.finalized_at === undefined ||
            receipt.receipt_representation_valid !== true ||
            (receipt.receipt_is_text
              ? receipt.receipt_text_matches !== true
              : canonicalizeAflTradeJson(receipt.receipt_json) !== receiptCanonicalJson)
          ) {
            throw new AflTradeFactualReconciliationPersistenceError(
              'REPLAY_CONFLICT',
              'The reconciliation run ID already exists with different immutable content.'
            );
          }
          await transaction.query(`DROP TABLE pg_temp.${stagedReceiptTable}`);
          return persistedRun(run, true);
        }
        await requireExactPolicy(transaction, run);
        await insertOpenRun(transaction, run, stagedReceiptTable, receiptCanonicalSha256);
        await insertRunInputs(transaction, run);
        await insertResults(transaction, run);
        await advanceHeads(transaction, run);
        await transaction.query(
          `UPDATE outcome_factual_reconciliation_run
              SET status='approved', completed_at=$2, finalized_at=$2,
                  output_set_sha256=$3
            WHERE factual_run_id=$1 AND finalized_at IS NULL`,
          [run.factualRunId, run.content.completedAt, run.content.outputSetSha256]
        );
        const finalized = await transaction.query<{ finalized_at: string | Date | null }>(
          `SELECT finalized_at FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1`,
          [run.factualRunId]
        );
        if (!finalized.rows[0]?.finalized_at) {
          throw new AflTradeFactualReconciliationPersistenceError(
            'PERSISTENCE_REJECTED',
            'The factual reconciliation run did not finalize atomically.'
          );
        }
        await transaction.query(`DROP TABLE pg_temp.${stagedReceiptTable}`);
        return persistedRun(run, false);
      });
    } catch (error) {
      if (error instanceof AflTradeFactualReconciliationPersistenceError) throw error;
      throw new AflTradeFactualReconciliationPersistenceError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the reconciliation run.'
      );
    }
  }
}

// Stream bounded UTF-8 bytes into a transaction-owned large object, then stage
// uncompressed text in one conversion. Avoid repeatedly copying a growing string.
// The object is unlinked before permanent writes; rollback also removes its creation.
async function stageCanonicalReceipt(transaction: AflOutcomeSqlTransaction, canonical: string) {
  const assembledTable = `factual_receipt_assembled_${randomUUID().replaceAll('-', '')}`;
  await transaction.query(
    `CREATE TEMP TABLE ${assembledTable} (receipt TEXT NOT NULL) ON COMMIT DROP`
  );
  await transaction.query(
    `ALTER TABLE pg_temp.${assembledTable} ALTER COLUMN receipt SET STORAGE EXTERNAL`
  );
  const created = await transaction.query<{ oid: number }>('SELECT lo_create(0) AS oid');
  const oid = created.rows[0]?.oid;
  if (typeof oid !== 'number' || !Number.isInteger(oid) || oid <= 0 || oid > 0xffffffff) {
    throw new AflTradeFactualReconciliationPersistenceError(
      'PERSISTENCE_REJECTED',
      'Receipt transfer did not allocate one transaction-owned large object.'
    );
  }
  // One Mi UTF-16 code units encodes to at most three MiB of UTF-8. Keep
  // surrogate pairs together and advance the large-object offset in bytes.
  let byteOffset = 0;
  for (let offset = 0; offset < canonical.length;) {
    let end = Math.min(offset + 1024 ** 2, canonical.length);
    const lastUnit = canonical.charCodeAt(end - 1);
    if (end < canonical.length && lastUnit >= 0xd800 && lastUnit <= 0xdbff) end--;
    const bytes = Buffer.from(canonical.slice(offset, end), 'utf8');
    await transaction.query('SELECT lo_put($1,$2,$3)', [oid, byteOffset, bytes]);
    byteOffset += bytes.length;
    offset = end;
  }
  await transaction.query(
    `INSERT INTO pg_temp.${assembledTable} SELECT convert_from(lo_get($1),'UTF8')`,
    [oid]
  );
  const removed = await transaction.query<{ removed: number }>('SELECT lo_unlink($1) AS removed', [
    oid,
  ]);
  if (removed.rows[0]?.removed !== 1) {
    throw new AflTradeFactualReconciliationPersistenceError(
      'PERSISTENCE_REJECTED',
      'Receipt transfer did not remove its transaction-owned large object.'
    );
  }
  return assembledTable;
}

function requireEnvironment(
  expected: string,
  execution: AflTradeFactualReconciliationExecutionContext
) {
  if (!execution || execution.environment !== expected) {
    throw new AflTradeFactualReconciliationPersistenceError(
      'ENVIRONMENT_MISMATCH',
      'Execution environment must equal the immutable factual reconciliation environment.'
    );
  }
}

function requireStoredPolicy(stored: StoredPolicyRow, policy: AflTradeFactualReconciliationPolicy) {
  if (
    stored.policy_sha256 !== policy.policySha256 ||
    canonicalizeAflTradeJson(stored.policy_json) !== canonicalizeAflTradeJson(policy.content) ||
    stored.environment !== policy.content.environment ||
    stored.competition !== policy.content.competition ||
    stored.valid_from_season !== policy.content.validFromSeason ||
    stored.valid_through_season !== policy.content.validThroughSeason ||
    stored.status !== 'approved'
  ) {
    throw new AflTradeFactualReconciliationPersistenceError(
      'REPLAY_CONFLICT',
      'The policy ID already exists with different content or approval state.'
    );
  }
}

async function requireExactPolicy(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeFactualReconciliationRun
) {
  const stored = await transaction.query<StoredPolicyRow>(
    `SELECT policy_sha256, policy_json, environment, competition, valid_from_season,
            valid_through_season, status
       FROM outcome_factual_reconciliation_policy WHERE policy_id=$1`,
    [run.content.policy.policyId]
  );
  if (!stored.rows[0]) {
    throw new AflTradeFactualReconciliationPersistenceError(
      'POLICY_MISMATCH',
      'The exact approved reconciliation policy has not been retained.'
    );
  }
  try {
    requireStoredPolicy(stored.rows[0], run.content.policy);
  } catch {
    throw new AflTradeFactualReconciliationPersistenceError(
      'POLICY_MISMATCH',
      'The run policy does not match the exact retained approved policy.'
    );
  }
}

async function insertOpenRun(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeFactualReconciliationRun,
  stagedReceiptTable: string,
  receiptCanonicalSha256: string
) {
  const content = run.content;
  await transaction.query(
    `INSERT INTO outcome_factual_reconciliation_run
      (factual_run_id,policy_id,environment,competition,season_year,algorithm_version,
       input_set_sha256,output_set_sha256,run_sha256,status,source_fact_count,
       reconciled_fact_count,conflict_count,started_at,completed_at,finalized_at,
       receipt_json,receipt_canonical_json,receipt_canonical_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staged',$10,$11,$12,$13,NULL,NULL,NULL,
             (SELECT receipt FROM pg_temp.${stagedReceiptTable}),$14)`,
    [
      run.factualRunId,
      content.policy.policyId,
      content.environment,
      content.competition,
      content.seasonYear,
      content.algorithmVersion,
      content.inputSetSha256,
      content.outputSetSha256,
      run.runSha256,
      content.counts.sourceFacts,
      content.counts.reconciledFacts,
      content.counts.conflicting,
      content.startedAt,
      receiptCanonicalSha256,
    ]
  );
}

async function insertRunInputs(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeFactualReconciliationRun
) {
  for (const [index, membership] of run.content.sourceMemberships.entries()) {
    const ordinal = index + 1;
    const membershipSha256 = sha256AflTradeCanonicalJson(membership);
    const membershipJson = canonicalizeAflTradeJson(membership);
    switch (membership.fact.content.factKind) {
      case 'player_match_metric':
      case 'player_season_metric':
        await transaction.query(
          `INSERT INTO outcome_factual_reconciliation_metric_input
            (factual_run_id,metric_fact_id,ordinal,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [run.factualRunId, membership.fact.factId, ordinal, membershipSha256, membershipJson]
        );
        break;
      case 'player_appearance':
        await transaction.query(
          `INSERT INTO outcome_factual_reconciliation_appearance_input
            (factual_run_id,appearance_fact_id,ordinal,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [run.factualRunId, membership.fact.factId, ordinal, membershipSha256, membershipJson]
        );
        break;
      case 'match_universe':
        await transaction.query(
          `INSERT INTO outcome_factual_reconciliation_match_input
            (factual_run_id,match_fact_id,ordinal,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [run.factualRunId, membership.fact.factId, ordinal, membershipSha256, membershipJson]
        );
        break;
      case 'player_achievement':
        throw new AflTradeFactualReconciliationPersistenceError(
          'INVALID_RUN',
          'Achievement facts cannot enter numeric reconciliation.'
        );
    }
  }
}

async function insertResults(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeFactualReconciliationRun
) {
  const advanceByResultId = new Map(
    run.content.headAdvances.map((advance) => [advance.reconciledFactId, advance])
  );
  const sourceMembershipById = new Map(
    run.content.sourceMemberships.map((membership) => [membership.fact.factId, membership])
  );
  for (const result of run.content.results) {
    const content = result.content;
    const advance = advanceByResultId.get(result.reconciledFactId);
    if (!advance) {
      throw new AflTradeFactualReconciliationPersistenceError(
        'INVALID_RUN',
        'Each result requires one exact head advance.'
      );
    }
    await transaction.query(
      `INSERT INTO outcome_reconciled_factual_metric
        (reconciled_fact_id,factual_run_id,result_kind,player_id,club_scope_kind,club_id,
         club_scope_reason_code,match_id,competition,season_year,
         grain,metric_code,definition_version,state,numeric_value,unit,reason_code,
         coverage_numerator,coverage_denominator,effective_through,fact_sha256,fact_json,
         recorded_at,expected_head_revision,head_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25)`,
      [
        result.reconciledFactId,
        run.factualRunId,
        content.resultKind,
        content.playerId,
        content.clubScope.kind,
        content.clubScope.clubId,
        content.clubScope.kind === 'reviewed_unattributed' ? content.clubScope.reasonCode : null,
        content.matchId,
        content.competition,
        content.seasonYear,
        content.grain,
        content.metricCode,
        content.definitionVersion,
        content.availability.state,
        content.availability.numericValue,
        content.unit,
        content.availability.reasonCode,
        content.coverageNumerator,
        content.coverageDenominator,
        content.effectiveThrough,
        result.factSha256,
        canonicalizeAflTradeJson(content),
        content.recordedAt,
        advance.expectedRevision,
        advance.nextRevision,
      ]
    );
    if (content.resultKind === 'source_metric') {
      for (const [index, member] of content.members.entries()) {
        const selected = content.selectedMemberIds.includes(member.sourceFactId);
        const storedMember = { ...member, selected };
        await transaction.query(
          `INSERT INTO outcome_reconciled_factual_metric_member
            (reconciled_fact_id,metric_fact_id,ordinal,priority,selected,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            result.reconciledFactId,
            member.sourceFactId,
            index + 1,
            member.priority,
            selected,
            sha256AflTradeCanonicalJson(storedMember),
            canonicalizeAflTradeJson(storedMember),
          ]
        );
      }
    } else {
      for (const [index, member] of content.appearanceMembers.entries()) {
        const selected = content.selectedAppearanceFactIds.includes(member.sourceFactId);
        const storedMember = { ...member, selected };
        await transaction.query(
          `INSERT INTO outcome_reconciled_factual_game_appearance_member
            (reconciled_fact_id,appearance_fact_id,ordinal,priority,selected,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            result.reconciledFactId,
            member.sourceFactId,
            index + 1,
            member.priority,
            selected,
            sha256AflTradeCanonicalJson(storedMember),
            canonicalizeAflTradeJson(storedMember),
          ]
        );
      }
      for (const [index, matchFactId] of content.matchUniverseFactIds.entries()) {
        const source = sourceMembershipById.get(matchFactId)?.fact;
        if (source?.content.factKind !== 'match_universe') {
          throw new AflTradeFactualReconciliationPersistenceError(
            'INVALID_RUN',
            'Games match evidence is not one exact source membership.'
          );
        }
        const preference = run.content.policy.content.gamesRule.matchUniverseSources.find(
          ({ provider, capabilityId }) =>
            provider === source.content.provider && capabilityId === source.content.capabilityId
        );
        if (!preference) {
          throw new AflTradeFactualReconciliationPersistenceError(
            'INVALID_RUN',
            'Games match evidence has no exact policy priority.'
          );
        }
        const storedMember = {
          sourceFactId: matchFactId,
          sourceFactSha256: source.factSha256,
          priority: preference.priority,
          provider: source.content.provider,
          capabilityId: source.content.capabilityId,
          selected: content.selectedMatchUniverseFactIds.includes(matchFactId),
        };
        await transaction.query(
          `INSERT INTO outcome_reconciled_factual_game_match_member
            (reconciled_fact_id,match_fact_id,ordinal,priority,selected,membership_sha256,membership_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            result.reconciledFactId,
            matchFactId,
            index + 1,
            preference.priority,
            storedMember.selected,
            sha256AflTradeCanonicalJson(storedMember),
            canonicalizeAflTradeJson(storedMember),
          ]
        );
      }
    }
  }
}

async function advanceHeads(
  transaction: AflOutcomeSqlTransaction,
  run: AflTradeFactualReconciliationRun
) {
  const resultById = new Map(
    run.content.results.map((result) => [result.reconciledFactId, result])
  );
  for (const advance of run.content.headAdvances) {
    const result = resultById.get(advance.reconciledFactId);
    if (!result) {
      throw new AflTradeFactualReconciliationPersistenceError(
        'INVALID_RUN',
        'A reconciliation head cannot reference a result outside its run.'
      );
    }
    const persisted = await transaction.query(
      `INSERT INTO outcome_reconciled_factual_metric_head
        (subject_key,revision,reconciled_fact_id,updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (subject_key) DO UPDATE
         SET revision=EXCLUDED.revision,reconciled_fact_id=EXCLUDED.reconciled_fact_id,
             updated_at=EXCLUDED.updated_at
       WHERE outcome_reconciled_factual_metric_head.revision=$5`,
      [
        advance.subjectKey,
        advance.nextRevision,
        advance.reconciledFactId,
        result.content.recordedAt,
        advance.expectedRevision,
      ]
    );
    if (persisted.rowCount !== 1) {
      throw new AflTradeFactualReconciliationPersistenceError(
        'STALE_REVISION',
        `The current factual head changed before ${advance.subjectKey} could advance.`
      );
    }
  }
}

function persistedPolicy(
  policy: AflTradeFactualReconciliationPolicy,
  idempotentReplay: boolean
): PersistedAflTradeFactualReconciliationPolicy {
  return { policyId: policy.policyId, idempotentReplay, publicationEligible: false };
}

function persistedRun(
  run: AflTradeFactualReconciliationRun,
  idempotentReplay: boolean
): PersistedAflTradeFactualReconciliationRun {
  return {
    factualRunId: run.factualRunId,
    sourceFactCount: run.content.counts.sourceFacts,
    reconciledFactCount: run.content.counts.reconciledFacts,
    conflictCount: run.content.counts.conflicting,
    idempotentReplay,
    publicationEligible: false,
  };
}
