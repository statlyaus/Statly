import { describe, expect, it, vi } from 'vitest';

import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateTradeEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluation';
import type { GovernedPrivateEvaluationSelector } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import { createPostgresPrivateEvaluationInspectionStore } from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationInspectionStore';

const selector: GovernedPrivateEvaluationSelector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
};

describe('PostgreSQL private evaluation inspection store', () => {
  it('retains and exactly reads one ready authority snapshot and inspection receipt', async () => {
    let snapshotRow: { snapshot_json: unknown; artifact_json: unknown } | null = null;
    let receiptRow: { receipt_json: unknown; artifact_json: unknown } | null = null;
    const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
      if (sql.includes('transaction_timestamp()')) {
        return {
          rows: [{ trusted_at: '2026-08-18T01:00:00.000Z' }],
          rowCount: 1,
        };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_authority_snapshot')) {
        snapshotRow = {
          snapshot_json: JSON.parse(String(parameters.at(-2))),
          artifact_json: JSON.parse(String(parameters.at(-1))),
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_inspection_receipt')) {
        receiptRow = {
          receipt_json: JSON.parse(String(parameters.at(-2))),
          artifact_json: JSON.parse(String(parameters.at(-1))),
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_private_evaluation_authority_snapshot')) {
        return { rows: snapshotRow === null ? [] : [snapshotRow], rowCount: snapshotRow ? 1 : 0 };
      }
      if (sql.includes('FROM outcome_private_evaluation_inspection_receipt')) {
        return { rows: receiptRow === null ? [] : [receiptRow], rowCount: receiptRow ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const transaction = { query } satisfies AflOutcomeSqlTransaction;
    const transactionCall = vi.fn(
      async <T>(
        work: (candidate: AflOutcomeSqlTransaction) => Promise<T>,
        _options?: { isolationLevel?: string; accessMode?: string }
      ) => work(transaction)
    );
    const client = {
      query,
      transaction: transactionCall,
    } as AflOutcomeSqlClient;
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const inspectAuthority = vi.fn(async () => ({
      promotedWorkbookSha256: '8'.repeat(64),
      expectedHead: { generationId: null, revision: 0, status: 'absent' as const },
      validThrough: '2026-08-18T01:05:00.000Z',
      evidence: [
        {
          role: 'confirmed_result' as const,
          source: 'postgres_json' as const,
          document: { evidence: 'confirmed-result' },
          createdAt: '2026-08-18T00:59:00.000Z',
        },
      ],
      blockers: [],
    }));
    const inspectionStore = createPostgresPrivateEvaluationInspectionStore({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectAuthority,
    });
    const workspace = createGovernedPrivateTradeEvaluationWorkspace({
      inspectionStore,
      executionStore: {
        execute: async () => {
          throw new Error('Execution is outside this inspection-store test.');
        },
      },
    });

    const result = await workspace.inspect(selector);

    expect(result.state).toBe('ready');
    expect(inspectAuthority).toHaveBeenCalledWith(transaction, selector, '2026-08-18T01:00:00.000Z');
    expect(transactionCall).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable_read',
      accessMode: 'read_write',
    });
    expect(snapshotRow).not.toBeNull();
    expect(snapshotRow).toMatchObject({
      snapshot_json: {
        content: { promotedWorkbookSha256: '8'.repeat(64) },
      },
    });
    expect(receiptRow).not.toBeNull();
    expect(receiptRow).toMatchObject({
      receipt_json: {
        content: {
          observedDependencies: [
            {
              role: 'confirmed_result',
              artifact: expect.objectContaining({
                artifactId: expect.stringMatching(/^artifact:[a-f0-9]{64}$/u),
              }),
            },
          ],
        },
      },
    });
  });
});
