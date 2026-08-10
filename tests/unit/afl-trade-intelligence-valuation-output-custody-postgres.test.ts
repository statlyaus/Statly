// @vitest-environment node

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

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
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradeValuationOutputCustodyOperationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresValuationOutputCustodyOperationAuthority';
import {
  aflTradeValuationOutputCustodyOperationSchema,
  aflTradeValuationOutputCustodyReceiptSchema,
  type AflTradeValuationOutputCustodyOperation,
  type AflTradeValuationOutputCustodyOperationScope,
} from '@/server/aflTradeIntelligence/valuation/valuationOutputCustody';

const MIGRATION = readFileSync(
  new URL(
    '../../prisma/afl-trade-outcomes/migrations/0036_valuation_output_custody_authority/migration.sql',
    import.meta.url
  ),
  'utf8'
);
const VERIFIED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

class PgliteSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly db: PGlite) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.db.query<Row>(sql, [...parameters]);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const result = await work(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

const scope: AflTradeValuationOutputCustodyOperationScope = {
  environment: 'test_fixture',
  valuationOutputInventoryId: `valuation-output-inventory:${'a'.repeat(64)}`,
  outputSetSha256: 'b'.repeat(64),
  repositoryAssurance: 'fixture_memory',
  custodyProfileId: null,
  artifactCount: 1,
};

async function completionFor(operation: AflTradeValuationOutputCustodyOperation) {
  const artifact = createAflTradeCanonicalJsonArtifactRef(
    { inventoryId: scope.valuationOutputInventoryId },
    operation.content.verifiedAt
  );
  const artifactReadback = createAflTradeCanonicalJsonArtifactRef(
    { artifactId: artifact.artifactId },
    operation.content.verifiedAt
  );
  const content = {
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
    verifiedAt: operation.content.verifiedAt,
    verification: 'exact_replay_then_immutable_readback' as const,
    publicationEligible: false as const,
  };
  const receipt = aflTradeValuationOutputCustodyReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('valuation-output-custody', content),
    content,
  });
  const receiptArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    receipt,
    operation.content.verifiedAt
  );
  const repository = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  await repository.putIfAbsent(
    receiptArtifactRef,
    new TextEncoder().encode(canonicalizeAflTradeJson(receipt))
  );
  const receiptReadback = await verifyAflTradeArtifactReadback(
    repository,
    receiptArtifactRef,
    operation.content.verifiedAt,
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
      operation.content.verifiedAt
    ),
  };
}

describe('valuation-output custody PostgreSQL authority', () => {
  let db: PGlite | null = null;
  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it('compiles and enforces trusted acquire, exact completion replay, and terminal immutability', async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture','non_production','production');
      CREATE FUNCTION "reject_outcome_valuation_dataset_mutation"() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'append-only'; END;
      $$ LANGUAGE plpgsql;
    `);
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    const authority = createPostgresAflTradeValuationOutputCustodyOperationAuthority(
      new PgliteSqlClient(db)
    );

    const operation = aflTradeValuationOutputCustodyOperationSchema.parse(
      await authority.acquire(scope)
    );
    expect(operation.content.verifiedAt).toMatch(VERIFIED_AT_PATTERN);
    await authority.complete(await completionFor(operation));
    await expect(authority.complete(await completionFor(operation))).resolves.toBeUndefined();

    const stored = await db.query<{ status: string; receipt_id: string }>(
      `SELECT status,receipt_id FROM outcome_valuation_output_custody_operation`
    );
    expect(stored.rows).toEqual([
      { status: 'completed', receipt_id: expect.stringMatching(/^valuation-output-custody:/) },
    ]);
    await expect(
      db.exec(`UPDATE outcome_valuation_output_custody_operation SET artifact_count=2`)
    ).rejects.toThrow(/open-to-completed|shape|append-only/i);
  });
});
