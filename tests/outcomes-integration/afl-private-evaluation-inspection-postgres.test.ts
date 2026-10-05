import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createGovernedPrivateTradeEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluation';
import type { GovernedPrivateEvaluationSelector } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import { createPostgresPrivateEvaluationInspectionStore } from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationInspectionStore';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_private_evaluation_inspection_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
});

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL governed private evaluation inspection', () => {
  it('retains exact ready and unavailable inspections and rejects mutation', async () => {
    const readySelector: GovernedPrivateEvaluationSelector = {
      valuationScopeKey: 'afl-men:2025-trades',
      tradeId: 'workbook-2025-ready-evaluation',
    };
    const unavailableSelector: GovernedPrivateEvaluationSelector = {
      valuationScopeKey: 'afl-men:2025-trades',
      tradeId: 'workbook-2025-unavailable-evaluation',
    };
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const inspectionStore = createPostgresPrivateEvaluationInspectionStore({
      client: createPgAflOutcomeSqlClient(outcomesPool),
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectAuthority: async (_transaction, selector, trustedAt) => {
        if (selector.tradeId === readySelector.tradeId) {
          return {
            promotedWorkbookSha256: '8'.repeat(64),
            expectedHead: { generationId: null, revision: 0, status: 'absent' as const },
            validThrough: new Date(Date.parse(trustedAt) + 5 * 60 * 1_000).toISOString(),
            evidence: [
              {
                role: 'confirmed_result' as const,
                source: 'postgres_json' as const,
                document: { evidence: 'exact-confirmed-result' },
                createdAt: trustedAt,
              },
            ],
            blockers: [],
          };
        }
        return {
          promotedWorkbookSha256: null,
          expectedHead: { generationId: null, revision: 0, status: 'absent' as const },
          validThrough: null,
          evidence: [],
          blockers: [
            {
              code: 'confirmed_result_not_promoted',
              authorityClass: 'confirmed_result' as const,
              classification: 'internal_evidence' as const,
              assetId: null,
              message: 'No current confirmed-result promotion exists for this trade.',
              evidenceRefs: [],
            },
          ],
        };
      },
    });
    const workspace = createGovernedPrivateTradeEvaluationWorkspace({
      inspectionStore,
      executionStore: {
        execute: async () => {
          throw new Error('Execution is outside this inspection-store integration test.');
        },
      },
    });

    const ready = await workspace.inspect(readySelector);
    expect(ready).toMatchObject({
      state: 'ready',
      selector: readySelector,
      reviewGuard: {
        authoritySnapshotId: expect.stringMatching(
          /^private-evaluation-authority-snapshot:[a-f0-9]{64}$/u
        ),
        inspectionReceiptId: expect.stringMatching(
          /^private-evaluation-inspection:[a-f0-9]{64}$/u
        ),
      },
    });
    if (ready.state !== 'ready') throw new Error('Expected one ready inspection.');
    await expect(
      inspectionStore.loadAuthoritySnapshot(ready.reviewGuard.authoritySnapshotId)
    ).resolves.toMatchObject({
      snapshotId: ready.reviewGuard.authoritySnapshotId,
      content: {
        selector: readySelector,
        promotedWorkbookSha256: '8'.repeat(64),
        dependencies: [
          {
            role: 'confirmed_result',
            artifact: expect.objectContaining({
              artifactId: expect.stringMatching(/^artifact:[a-f0-9]{64}$/u),
            }),
          },
        ],
      },
    });

    const unavailable = await workspace.inspect(unavailableSelector);
    expect(unavailable).toMatchObject({
      state: 'unavailable',
      selector: unavailableSelector,
      blockers: [{ code: 'confirmed_result_not_promoted' }],
      inspectionReceipt: {
        content: {
          promotedWorkbookSha256: null,
          authoritySnapshotId: null,
          observedDependencies: [],
        },
      },
    });

    const retained = await outcomesPool.query<{
      receipt_id: string;
      state: string;
      workbook_sha256: string | null;
    }>(
      `SELECT receipt_id,state,workbook_sha256
         FROM outcome_private_evaluation_inspection_receipt
        ORDER BY state`
    );
    expect(retained.rows).toHaveLength(2);
    expect(retained.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'ready', workbook_sha256: '8'.repeat(64) }),
        expect.objectContaining({ state: 'unavailable', workbook_sha256: null }),
      ])
    );

    await expect(
      outcomesPool.query(
        `UPDATE outcome_private_evaluation_inspection_receipt
            SET blocker_count=blocker_count
          WHERE receipt_id=$1`,
        [ready.reviewGuard.inspectionReceiptId]
      )
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});
