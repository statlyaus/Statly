import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchOperationId,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';

const id = (kind: string, character: string) => `${kind}:${character.repeat(64)}`;

function activationClient(input: { readonly exactCaptureClaimBinding: boolean }): {
  readonly client: AflOutcomeSqlClient;
  readonly activationQueries: () => number;
} {
  let activationQueries = 0;
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
      if (sql.includes('SET TRANSACTION')) return { rows: [], rowCount: null };
      if (sql.includes('AS preparation_authority')) {
        return {
          rows: [
            {
              preparation_authority: 'dispatch_bound_private_factual_output',
              dispatch_request_id: id('private-valuation-dispatch-request', '5'),
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
        return { rows: [{}] as Row[], rowCount: 1 };
      }
      if (sql.includes('outcome_private_evaluation_cohort_capture')) {
        return {
          rows: (input.exactCaptureClaimBinding
            ? [{ dispatch_request_id: id('private-valuation-dispatch-request', '5') }]
            : []) as Row[],
          rowCount: input.exactCaptureClaimBinding ? 1 : 0,
        };
      }
      if (sql.includes('advance_outcome_current_private_evaluation_batch')) {
        activationQueries += 1;
        return {
          rows: [
            {
              batch_id: id('private-evaluation-batch', '2'),
              revision: 1,
              transition_id: id('private-evaluation-batch-transition', '3'),
              activated_at: '2026-08-25T10:00:00.000Z',
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL in fixture: ${sql}`);
    },
  };
  return {
    client: {
      query: transaction.query,
      async transaction<T>(work: (value: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
        return work(transaction);
      },
    },
    activationQueries: () => activationQueries,
  };
}

describe('PostgreSQL private evaluation batch repository', () => {
  it('rejects dispatch-bound private activation without its captured live claim', async () => {
    const fixture = activationClient({ exactCaptureClaimBinding: true });
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      fixture.client,
      async () => false
    );
    const batchId = id('private-evaluation-batch', '2');
    const operationId = createGovernedPrivateEvaluationBatchOperationId({
      scopeKey: 'afl-men:2026-trades',
      batchId,
      expectedRevision: 0,
      action: 'activate',
    });

    await expect(
      repository.advance({
        scopeKey: 'afl-men:2026-trades',
        batchId,
        expectedRevision: 0,
        operationId,
        action: 'activate',
      })
    ).rejects.toThrow(/captured live dispatch claim/i);
    expect(fixture.activationQueries()).toBe(0);
  });

  it('binds a dispatch-bound private activation claim to the exact cohort capture', async () => {
    const fixture = activationClient({ exactCaptureClaimBinding: false });
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      fixture.client,
      async () => false
    );
    const batchId = id('private-evaluation-batch', '2');
    const operationId = createGovernedPrivateEvaluationBatchOperationId({
      scopeKey: 'afl-men:2026-trades',
      batchId,
      expectedRevision: 0,
      action: 'activate',
    });

    await expect(
      repository.advance({
        scopeKey: 'afl-men:2026-trades',
        batchId,
        expectedRevision: 0,
        operationId,
        action: 'activate',
        cohortOperationId: id('private-evaluation-cohort-run', '4'),
        dispatchClaim: {
          requestId: id('private-valuation-dispatch-request', '5'),
          claimId: id('private-valuation-dispatch-claim', '6'),
          leaseToken: 'fixture-live-lease-token',
        },
      })
    ).rejects.toThrow(/lost current authority/i);
    expect(fixture.activationQueries()).toBe(0);
  });

  it('probes public or dispatch-bound private prepared authority after an ambiguous insert', async () => {
    let currentnessSql = '';
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
        currentnessSql = sql;
        return { rows: [{ is_current: true }] as Row[], rowCount: 1 };
      },
      async transaction(): Promise<never> {
        throw new TypeError(
          'Private evaluation batch generation is not exact current prepared authority'
        );
      },
    };
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      client,
      async () => false
    );
    const batch = createGovernedPrivateEvaluationBatch({
      scopeKey: 'afl-men:2026-trades',
      preparedInputSetId: id('prepared-valuation-input-set', '1'),
      preparedInputSetRevision: 2,
      factualReleaseId: id('outcome-release', '2'),
      modelQualificationId: id('model-qualification', '3'),
      modelQualificationWorkId: id('model-qualification-work', '4'),
      entries: [
        {
          tradeId: 'trade:fixture',
          state: 'unavailable',
          blockers: [{ code: 'engineering_unavailable', message: 'Fixture blocker.' }],
        },
      ],
      createdAt: '2026-08-25T10:00:00.000Z',
    });

    await expect(repository.register(batch)).rejects.toThrow(
      'Private evaluation batch generation is not exact current prepared authority'
    );
    expect(currentnessSql).toContain(
      "preparationAuthority'='dispatch_bound_private_factual_output"
    );
    expect(currentnessSql).toContain('outcome_private_valuation_model_request_binding');
    expect(currentnessSql).toContain('LEFT JOIN outcome_active_release');
  });
});
