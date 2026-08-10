import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import { aflTradeArtifactReadbackReceiptSchema } from '../artifacts/immutableArtifactRepository';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeValuationOutputCustodyOperationSchema,
  aflTradeValuationOutputCustodyOperationScopeSchema,
  type AflTradeValuationOutputCustodyOperation,
  type AflTradeValuationOutputCustodyOperationAuthority,
  type AflTradeValuationOutputCustodyOperationScope,
  aflTradeValuationOutputCustodyReceiptSchema,
} from './valuationOutputCustody';

interface StoredOperationRow {
  operation_id: string;
  operation_json: unknown;
  status: string;
  receipt_id: string | null;
  receipt_json: unknown | null;
  receipt_artifact_json: unknown | null;
  receipt_readback_json: unknown | null;
  receipt_readback_artifact_json: unknown | null;
}

const completionSchema = z
  .object({
    operation: aflTradeValuationOutputCustodyOperationSchema,
    receipt: aflTradeValuationOutputCustodyReceiptSchema,
    receiptId: aflTradeContentAddressedIdSchema('valuation-output-custody'),
    receiptArtifactRef: aflTradeArtifactRefSchema,
    receiptReadback: aflTradeArtifactReadbackReceiptSchema,
    receiptReadbackArtifactRef: aflTradeArtifactRefSchema,
  })
  .strict();

function lockKey(scope: AflTradeValuationOutputCustodyOperationScope): string {
  return `valuation-output-custody:${scope.environment}:${scope.valuationOutputInventoryId}`;
}

function iso(value: Date | string | undefined, label: string): string {
  if (value === undefined) throw new Error(`PostgreSQL did not return ${label}.`);
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`PostgreSQL returned an invalid ${label}.`);
  return date.toISOString();
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

async function findStoredOperation(
  transaction: AflOutcomeSqlTransaction,
  scope: AflTradeValuationOutputCustodyOperationScope
): Promise<StoredOperationRow | null> {
  const result = await transaction.query<StoredOperationRow>(
    `SELECT operation_id, operation_json, status, receipt_id, receipt_json,
            receipt_artifact_json, receipt_readback_json, receipt_readback_artifact_json
       FROM outcome_valuation_output_custody_operation
      WHERE environment=$1 AND valuation_output_inventory_id=$2
      FOR UPDATE`,
    [scope.environment, scope.valuationOutputInventoryId]
  );
  if (result.rows.length > 1) {
    throw new Error('PostgreSQL returned multiple custody operations for one immutable inventory.');
  }
  return result.rows[0] ?? null;
}

function parseExactStoredOperation(
  row: StoredOperationRow,
  scope: AflTradeValuationOutputCustodyOperationScope
): AflTradeValuationOutputCustodyOperation {
  const operation = aflTradeValuationOutputCustodyOperationSchema.parse(row.operation_json);
  const {
    schemaVersion: _schemaVersion,
    verifiedAt: _verifiedAt,
    ...storedScope
  } = operation.content;
  if (!exactJson(storedScope, scope) || operation.operationId !== row.operation_id) {
    throw new Error('A conflicting custody operation already exists for this immutable inventory.');
  }
  return operation;
}

async function acquireOperation(
  client: AflOutcomeSqlClient,
  rawScope: AflTradeValuationOutputCustodyOperationScope
): Promise<AflTradeValuationOutputCustodyOperation> {
  const scope = aflTradeValuationOutputCustodyOperationScopeSchema.parse(rawScope);
  return client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      lockKey(scope),
    ]);
    const existing = await findStoredOperation(transaction, scope);
    if (existing !== null) return parseExactStoredOperation(existing, scope);

    const clock = await transaction.query<{ verified_at: Date | string }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS verified_at`
    );
    const content = {
      schemaVersion: 'afl-trade-valuation-output-custody-operation/v1' as const,
      ...scope,
      verifiedAt: iso(clock.rows[0]?.verified_at, 'the trusted custody-operation time'),
    };
    const operation = aflTradeValuationOutputCustodyOperationSchema.parse({
      operationId: createAflTradeContentAddress('valuation-output-custody-operation', content),
      content,
    });
    await transaction.query(
      `INSERT INTO outcome_valuation_output_custody_operation
        (operation_id, environment, valuation_output_inventory_id, output_set_sha256,
         repository_assurance, custody_profile_id, artifact_count, verified_at,
         operation_content_canonical_json, operation_canonical_json, operation_json, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text,$10::text,$10::jsonb,'open')`,
      [
        operation.operationId,
        scope.environment,
        scope.valuationOutputInventoryId,
        scope.outputSetSha256,
        scope.repositoryAssurance,
        scope.custodyProfileId,
        scope.artifactCount,
        content.verifiedAt,
        canonicalizeAflTradeJson(content),
        canonicalizeAflTradeJson(operation),
      ]
    );
    return operation;
  });
}

async function completeOperation(
  client: AflOutcomeSqlClient,
  rawInput: Parameters<AflTradeValuationOutputCustodyOperationAuthority['complete']>[0]
): Promise<void> {
  const input = completionSchema.parse(rawInput);
  const {
    schemaVersion: _schemaVersion,
    verifiedAt: _verifiedAt,
    ...operationScope
  } = input.operation.content;
  const scope = aflTradeValuationOutputCustodyOperationScopeSchema.parse(operationScope);
  const expectedReceiptArtifact = createAflTradeCanonicalJsonArtifactRef(
    input.receipt,
    input.operation.content.verifiedAt
  );
  const expectedReadbackArtifact = createAflTradeCanonicalJsonArtifactRef(
    input.receiptReadback,
    input.operation.content.verifiedAt
  );
  if (
    input.receiptId !== input.receipt.receiptId ||
    input.receipt.content.operationId !== input.operation.operationId ||
    !exactJson(input.receipt.content.operation, input.operation) ||
    !doAflTradeArtifactRefsExactlyMatch(input.receiptArtifactRef, expectedReceiptArtifact) ||
    !doAflTradeArtifactRefsExactlyMatch(input.receiptReadbackArtifactRef, expectedReadbackArtifact)
  ) {
    throw new Error(
      'The custody completion evidence does not match its exact operation and bytes.'
    );
  }
  await client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      lockKey(scope),
    ]);
    const stored = await findStoredOperation(transaction, scope);
    if (stored === null) throw new Error('The custody operation does not exist.');
    const operation = parseExactStoredOperation(stored, scope);
    if (!exactJson(operation, input.operation)) {
      throw new Error('The custody completion does not match its stored operation.');
    }
    if (stored.status === 'completed') {
      if (
        stored.receipt_id !== input.receiptId ||
        !exactJson(stored.receipt_json, input.receipt) ||
        !exactJson(stored.receipt_artifact_json, input.receiptArtifactRef) ||
        !exactJson(stored.receipt_readback_json, input.receiptReadback) ||
        !exactJson(stored.receipt_readback_artifact_json, input.receiptReadbackArtifactRef)
      ) {
        throw new Error('A conflicting completion already exists for this custody operation.');
      }
      return;
    }
    if (stored.status !== 'open') {
      throw new Error('The custody operation is not open for completion.');
    }
    const updated = await transaction.query(
      `UPDATE outcome_valuation_output_custody_operation
          SET status='completed', receipt_id=$2, receipt_content_canonical_json=$3::text,
              receipt_canonical_json=$4::text, receipt_json=$4::jsonb,
              receipt_artifact_json=$5::jsonb,
              receipt_readback_content_canonical_json=$6::text,
              receipt_readback_canonical_json=$7::text,
              receipt_readback_json=$7::jsonb,
              receipt_readback_artifact_json=$8::jsonb,
              completed_at=date_trunc('milliseconds',transaction_timestamp())
        WHERE operation_id=$1 AND status='open'`,
      [
        input.operation.operationId,
        input.receiptId,
        canonicalizeAflTradeJson(input.receipt.content),
        canonicalizeAflTradeJson(input.receipt),
        canonicalizeAflTradeJson(input.receiptArtifactRef),
        canonicalizeAflTradeJson(input.receiptReadback.content),
        canonicalizeAflTradeJson(input.receiptReadback),
        canonicalizeAflTradeJson(input.receiptReadbackArtifactRef),
      ]
    );
    if (updated.rowCount !== 1) {
      throw new Error('The custody operation lost its atomic completion race.');
    }
  });
}

export function createPostgresAflTradeValuationOutputCustodyOperationAuthority(
  client: AflOutcomeSqlClient
): AflTradeValuationOutputCustodyOperationAuthority {
  return {
    acquire: (scope) => acquireOperation(client, scope),
    complete: (input) => completeOperation(client, input),
  };
}
