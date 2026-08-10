import { doesAflTradeArtifactRefMatchCanonicalJson } from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePickPavModelExecutionSchema,
  type AflTradePickPavModelExecution,
} from './pickPavModelExecution';
import {
  aflTradePickPavModelCustodyReceiptSchema,
  type AflTradePickPavModelCustodyReceipt,
} from './pickPavModelExecutionCustody';
import type { AflTradePickPavModelExecutionRegistry } from './pickPavModelExecutionService';

interface StoredExecutionRow {
  execution_id: string;
  execution_json: unknown;
  custody_receipt_id: string;
  custody_json: unknown;
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function lockKey(executionId: string): string {
  return `pick-pav-model-execution:${executionId}`;
}

function authenticateInput(input: { execution: unknown; custody: unknown }): {
  execution: AflTradePickPavModelExecution;
  custody: AflTradePickPavModelCustodyReceipt;
} {
  const execution = aflTradePickPavModelExecutionSchema.parse(structuredClone(input.execution));
  const custody = aflTradePickPavModelCustodyReceiptSchema.parse(structuredClone(input.custody));
  if (
    custody.content.executionId !== execution.executionId ||
    custody.content.environment !== execution.content.environment ||
    !doesAflTradeArtifactRefMatchCanonicalJson(custody.content.executionArtifact, execution) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      custody.content.readbackReceiptArtifact,
      custody.content.executionReadback
    )
  ) {
    throw new TypeError('Pick-model custody does not authenticate the exact model execution.');
  }
  return { execution, custody };
}

async function findExecution(
  transaction: AflOutcomeSqlTransaction,
  executionId: string
): Promise<StoredExecutionRow | null> {
  const result = await transaction.query<StoredExecutionRow>(
    `SELECT execution_id, execution_json, custody_receipt_id, custody_json
       FROM outcome_pick_pav_model_execution
      WHERE execution_id=$1
      FOR UPDATE`,
    [executionId]
  );
  if (result.rows.length > 1) {
    throw new Error('PostgreSQL returned multiple rows for one pick-model execution.');
  }
  return result.rows[0] ?? null;
}

function requireExactReplay(
  row: StoredExecutionRow,
  execution: AflTradePickPavModelExecution,
  custody: AflTradePickPavModelCustodyReceipt
): void {
  const storedExecution = aflTradePickPavModelExecutionSchema.parse(row.execution_json);
  const storedCustody = aflTradePickPavModelCustodyReceiptSchema.parse(row.custody_json);
  if (
    row.execution_id !== execution.executionId ||
    row.custody_receipt_id !== custody.custodyReceiptId ||
    !exactJson(storedExecution, execution) ||
    !exactJson(storedCustody, custody)
  ) {
    throw new Error('A conflicting custody record exists for this pick-model execution.');
  }
}

async function requireFinalizedObservationSet(
  transaction: AflOutcomeSqlTransaction,
  execution: AflTradePickPavModelExecution
): Promise<void> {
  const result = await transaction.query(
    `SELECT observation_set_id
       FROM outcome_pick_pav_observation_set
      WHERE observation_set_id=$1 AND observation_set_sha256=$2
        AND environment=$3 AND competition=$4 AND release_id=$5 AND policy_id=$6
        AND status='finalized' AND finalized_at IS NOT NULL
        AND observation_set_json=$7::jsonb
      FOR KEY SHARE`,
    [
      execution.content.observationSetId,
      execution.content.observationSetSha256,
      execution.content.environment,
      execution.content.competition,
      execution.content.releaseId,
      execution.content.policyId,
      canonicalizeAflTradeJson(execution.content.observationSet),
    ]
  );
  if (result.rows.length !== 1) {
    throw new Error('The exact finalized pick-PAV observation set is not available.');
  }
}

export class PostgresAflTradePickPavModelExecutionRegistry implements AflTradePickPavModelExecutionRegistry {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persist(rawInput: {
    execution: AflTradePickPavModelExecution;
    custody: AflTradePickPavModelCustodyReceipt;
  }): Promise<{ idempotentReplay: boolean }> {
    const { execution, custody } = authenticateInput(rawInput);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        lockKey(execution.executionId),
      ]);
      const existing = await findExecution(transaction, execution.executionId);
      if (existing !== null) {
        requireExactReplay(existing, execution, custody);
        return { idempotentReplay: true };
      }
      await requireFinalizedObservationSet(transaction, execution);
      await transaction.query(
        `INSERT INTO outcome_pick_pav_model_execution
          (execution_id, observation_set_id, observation_set_sha256, environment, competition,
           release_id, policy_id, method_id, final_test_evaluation_started_at,
           completed_at, retained_at, execution_content_canonical_json,
           execution_canonical_json, execution_json, custody_receipt_id,
           custody_content_canonical_json, custody_canonical_json, custody_json,
           execution_readback_content_canonical_json, execution_readback_canonical_json,
           repository_assurance, custody_profile_id,
           execution_artifact_id, execution_artifact_sha256,
           readback_receipt_artifact_id, readback_receipt_artifact_sha256, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text,$13::text,$13::jsonb,
                 $14,$15::text,$16::text,$16::jsonb,$17::text,$18::text,$19,$20,$21,$22,$23,$24,
                 'retained_verified')`,
        [
          execution.executionId,
          execution.content.observationSetId,
          execution.content.observationSetSha256,
          execution.content.environment,
          execution.content.competition,
          execution.content.releaseId,
          execution.content.policyId,
          execution.content.methodId,
          execution.content.finalTestEvaluationStartedAt,
          execution.content.completedAt,
          custody.content.retainedAt,
          canonicalizeAflTradeJson(execution.content),
          canonicalizeAflTradeJson(execution),
          custody.custodyReceiptId,
          canonicalizeAflTradeJson(custody.content),
          canonicalizeAflTradeJson(custody),
          canonicalizeAflTradeJson(custody.content.executionReadback.content),
          canonicalizeAflTradeJson(custody.content.executionReadback),
          custody.content.repositoryAssurance,
          custody.content.custodyProfileId,
          custody.content.executionArtifact.artifactId,
          custody.content.executionArtifact.contentSha256,
          custody.content.readbackReceiptArtifact.artifactId,
          custody.content.readbackReceiptArtifact.contentSha256,
        ]
      );
      return { idempotentReplay: false };
    });
  }
}
