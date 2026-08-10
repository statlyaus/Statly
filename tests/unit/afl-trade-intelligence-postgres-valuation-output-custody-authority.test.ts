// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeFixtureArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradeValuationOutputCustodyOperationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresValuationOutputCustodyOperationAuthority';
import {
  aflTradeValuationOutputCustodyOperationSchema,
  aflTradeValuationOutputCustodyReceiptSchema,
  type AflTradeValuationOutputCustodyOperation,
  type AflTradeValuationOutputCustodyOperationScope,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';

const VERIFIED_AT = '2026-08-10T04:00:00.000Z';

const scope: AflTradeValuationOutputCustodyOperationScope = {
  environment: 'test_fixture',
  valuationOutputInventoryId: `valuation-output-inventory:${'a'.repeat(64)}`,
  outputSetSha256: 'b'.repeat(64),
  repositoryAssurance: 'fixture_memory',
  custodyProfileId: null,
  artifactCount: 1,
};

interface StoredOperation {
  operation_id: string;
  operation_json: unknown;
  status: 'open' | 'completed';
  receipt_id: string | null;
  receipt_json: unknown | null;
  receipt_artifact_json: unknown | null;
  receipt_readback_json: unknown | null;
  receipt_readback_artifact_json: unknown | null;
}

function createStatefulClient() {
  let stored: StoredOperation | null = null;
  let trustedClockReads = 0;
  const query = vi.fn(
    async (
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<AflOutcomeSqlQueryResult<any>> => {
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_valuation_output_custody_operation')) {
        return { rows: stored === null ? [] : [structuredClone(stored)], rowCount: stored ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO outcome_valuation_output_custody_operation')) {
        stored = {
          operation_id: String(parameters[0]),
          operation_json: JSON.parse(String(parameters[9])),
          status: 'open',
          receipt_id: null,
          receipt_json: null,
          receipt_artifact_json: null,
          receipt_readback_json: null,
          receipt_readback_artifact_json: null,
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE outcome_valuation_output_custody_operation')) {
        if (stored === null) throw new Error('missing operation');
        stored = {
          ...stored,
          status: 'completed',
          receipt_id: String(parameters[1]),
          receipt_json: JSON.parse(String(parameters[3])),
          receipt_artifact_json: JSON.parse(String(parameters[4])),
          receipt_readback_json: JSON.parse(String(parameters[6])),
          receipt_readback_artifact_json: JSON.parse(String(parameters[7])),
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('transaction_timestamp()')) {
        trustedClockReads += 1;
        return { rows: [{ verified_at: VERIFIED_AT }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  );
  const client = {
    query,
    transaction: async (work: Parameters<AflOutcomeSqlClient['transaction']>[0]) => work({ query }),
  } as AflOutcomeSqlClient;
  return {
    client,
    query,
    trustedClockReads: () => trustedClockReads,
    stored: () => stored,
  };
}

async function createCompletion(operation: AflTradeValuationOutputCustodyOperation) {
  const artifact = createAflTradeCanonicalJsonArtifactRef({ output: true }, VERIFIED_AT);
  const artifactReadback = createAflTradeCanonicalJsonArtifactRef({ readback: true }, VERIFIED_AT);
  const receiptContent = {
    schemaVersion: 'afl-trade-valuation-output-custody/v1' as const,
    environment: scope.environment,
    operationId: operation.operationId,
    operation,
    valuationOutputInventoryId: scope.valuationOutputInventoryId,
    valuationBundleId: `valuation-bundle:${'1'.repeat(64)}`,
    valuationCaseId: `valuation-case:${'2'.repeat(64)}`,
    valuationCalculationId: `valuation-calculation:${'3'.repeat(64)}`,
    tradeId: 'trade:fixture',
    valueUnitId: 'statly-pav/v1',
    artifactCount: 1,
    artifacts: [
      {
        role: 'valuation_output_inventory' as const,
        semanticId: scope.valuationOutputInventoryId,
        artifact,
        readbackReceiptArtifact: artifactReadback,
      },
    ],
    verifiedAt: VERIFIED_AT,
    verification: 'exact_replay_then_immutable_readback' as const,
    publicationEligible: false as const,
  };
  const receipt = aflTradeValuationOutputCustodyReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('valuation-output-custody', receiptContent),
    content: receiptContent,
  });
  const receiptArtifactRef = createAflTradeCanonicalJsonArtifactRef(receipt, VERIFIED_AT);
  const repository = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  await repository.putIfAbsent(
    receiptArtifactRef,
    new TextEncoder().encode(canonicalizeAflTradeJson(receipt))
  );
  const receiptReadback = await verifyAflTradeArtifactReadback(
    repository,
    receiptArtifactRef,
    VERIFIED_AT,
    receiptArtifactRef.byteLength
  );
  return {
    operation,
    receipt,
    receiptId: receipt.receiptId,
    receiptArtifactRef,
    receiptReadback,
    receiptReadbackArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      receiptReadback,
      VERIFIED_AT
    ),
  };
}

describe('PostgreSQL valuation-output custody operation authority', () => {
  it('uses trusted database time and replays the exact logical scope without minting another operation', async () => {
    const database = createStatefulClient();
    const authority = createPostgresAflTradeValuationOutputCustodyOperationAuthority(
      database.client
    );

    const first = aflTradeValuationOutputCustodyOperationSchema.parse(
      await authority.acquire(scope)
    );
    const replay = aflTradeValuationOutputCustodyOperationSchema.parse(
      await authority.acquire(scope)
    );

    expect(first).toEqual(replay);
    expect(first.content.verifiedAt).toBe(VERIFIED_AT);
    expect(database.trustedClockReads()).toBe(1);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
      `valuation-output-custody:${scope.environment}:${scope.valuationOutputInventoryId}`,
    ]);
  });

  it('rejects a conflicting replay for the same immutable inventory scope', async () => {
    const database = createStatefulClient();
    const authority = createPostgresAflTradeValuationOutputCustodyOperationAuthority(
      database.client
    );
    await authority.acquire(scope);

    await expect(authority.acquire({ ...scope, outputSetSha256: 'd'.repeat(64) })).rejects.toThrow(
      /conflicting custody operation/i
    );
    expect(database.trustedClockReads()).toBe(1);
  });

  it('atomically completes once, permits exact completion replay, and rejects conflicting receipt evidence', async () => {
    const database = createStatefulClient();
    const authority = createPostgresAflTradeValuationOutputCustodyOperationAuthority(
      database.client
    );
    const operation = aflTradeValuationOutputCustodyOperationSchema.parse(
      await authority.acquire(scope)
    );
    const completion = await createCompletion(operation);
    const { receiptId, receiptArtifactRef } = completion;

    await authority.complete(completion);
    await expect(authority.complete(completion)).resolves.toBeUndefined();

    const stored = database.stored();
    expect(stored).toMatchObject({ status: 'completed', receipt_id: receiptId });
    expect(canonicalizeAflTradeJson(stored?.receipt_artifact_json)).toBe(
      canonicalizeAflTradeJson(receiptArtifactRef)
    );

    await expect(
      authority.complete({
        ...completion,
        receiptId: `valuation-output-custody:${'f'.repeat(64)}`,
      })
    ).rejects.toThrow(/does not match its exact operation and bytes/i);
  });
});
