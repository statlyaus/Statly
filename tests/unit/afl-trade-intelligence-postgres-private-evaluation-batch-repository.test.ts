import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationBatchOperationId } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import {
  GovernedPrivateEvaluationBatchConflictError,
  PostgresGovernedPrivateEvaluationBatchRepository,
} from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';

const digest = (character: string) => character.repeat(64);
const scopeKey = 'afl-men:2025-trades';
const batchId = `private-evaluation-batch:${digest('1')}`;
const cohortOperationId = `private-evaluation-cohort-run:${digest('2')}`;
const requestId = `private-valuation-dispatch:${digest('3')}`;
const claimId = `private-valuation-dispatch-claim:${digest('4')}`;
const leaseToken = digest('5');

function activationInput() {
  return {
    scopeKey,
    batchId,
    expectedRevision: 2,
    operationId: createGovernedPrivateEvaluationBatchOperationId({
      scopeKey,
      batchId,
      expectedRevision: 2,
      action: 'activate',
    }),
    action: 'activate' as const,
    cohortOperationId,
  };
}

function clientWithTransaction(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
      return { rows: [], rowCount: 0 };
    },
    async transaction<Result>(work: (value: AflOutcomeSqlTransaction) => Promise<Result>) {
      return work(transaction);
    },
  };
}

describe('PostgreSQL private evaluation batch repository', () => {
  it('rejects dispatch claim material on the public activation method', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
        throw new Error('Public activation must fail before PostgreSQL.');
      },
    };
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      clientWithTransaction(transaction),
      async () => false
    );
    const input = {
      ...activationInput(),
      dispatchClaim: { requestId, claimId, leaseToken },
    };

    await expect(repository.advance(input)).rejects.toThrow(
      'Public private-batch activation rejects dispatch claim authority.'
    );
  });

  it('passes the exact live dispatch fence to one private activation function', async () => {
    const calls: { readonly sql: string; readonly parameters: readonly unknown[] }[] = [];
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(
        sql: string,
        parameters: readonly unknown[] = []
      ): Promise<AflOutcomeSqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        if (sql.includes('advance_outcome_current_private_evaluation_batch_from_dispatch_claim')) {
          return {
            rows: [
              {
                batch_id: batchId,
                revision: 3,
                transition_id: `private-evaluation-batch-transition:${digest('6')}`,
                activated_at: '2026-09-05T00:00:00.000Z',
              },
            ] as Row[],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      clientWithTransaction(transaction),
      async () => false
    );

    await expect(
      repository.advanceFromDispatchClaim({
        ...activationInput(),
        dispatchClaim: { requestId, claimId, leaseToken },
      })
    ).resolves.toMatchObject({ batchId, revision: 3 });

    const activation = calls.find(({ sql }) =>
      sql.includes('advance_outcome_current_private_evaluation_batch_from_dispatch_claim')
    );
    expect(calls.some(({ sql }) => sql.includes('SET LOCAL ROLE afl_trade_private_evaluation_coordinator'))).toBe(true);
    expect(activation?.parameters).toEqual([
      scopeKey,
      batchId,
      2,
      activationInput().operationId,
      'activate',
      'system:weekly-valuation-coordinator',
      cohortOperationId,
      requestId,
      claimId,
      createHash('sha256').update(leaseToken, 'utf8').digest('hex'),
    ]);
  });

  it('classifies a lost live dispatch claim as stale batch authority', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
        if (sql.includes('advance_outcome_current_private_evaluation_batch_from_dispatch_claim')) {
          throw new Error('Private valuation dispatch request lookup lost its live claim fence');
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      clientWithTransaction(transaction),
      async () => false
    );

    await expect(
      repository.advanceFromDispatchClaim({
        ...activationInput(),
        dispatchClaim: { requestId, claimId, leaseToken },
      })
    ).rejects.toBeInstanceOf(GovernedPrivateEvaluationBatchConflictError);
  });
});
