import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateEvaluationBatch } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';

const id = (kind: string, character: string) => `${kind}:${character.repeat(64)}`;

describe('PostgreSQL private evaluation batch repository', () => {
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
