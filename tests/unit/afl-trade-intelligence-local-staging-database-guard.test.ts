import { describe, expect, it } from 'vitest';

import {
  assertNoRetainedAflTablesResultsNormalizationFailure,
  stageLocalAflTradeFiveSeasonAflTablesOutcomes,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesStaging';
import { stageLocalAflTradeOfficialAfl2026Outcomes } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Staging';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const expectedRuntimeNonce = 'a'.repeat(64);

function unauthenticatedClient() {
  const statements: string[] = [];
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql) {
      statements.push(sql);
      return { rows: [] as Row[], rowCount: 0 };
    },
    async transaction(work) {
      return work(this);
    },
  };
  return { client, statements };
}

describe('local capture staging database guard', () => {
  it.each([
    ['five-season AFL Tables', stageLocalAflTradeFiveSeasonAflTablesOutcomes],
    ['official AFL 2026', stageLocalAflTradeOfficialAfl2026Outcomes],
  ] as const)('fails closed before mutation for %s staging', async (_label, stage) => {
    const { client, statements } = unauthenticatedClient();

    await expect(
      stage(client, {
        artifactRootDirectory: '/tmp/statly-local-staging-guard',
        expectedRuntimeNonce,
      })
    ).rejects.toThrow(/does not belong to this local stack launch/i);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('statly_local_runtime.outcomes_process_identity');
    expect(statements[0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  });

  it('blocks recapture when a retained results normalization failure exists', async () => {
    const statements: string[] = [];
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql) {
        statements.push(sql);
        return { rows: [{ capture_id: 'retained-results-capture' }] as Row[], rowCount: 1 };
      },
      async transaction(work) {
        return work(this);
      },
    };

    await expect(assertNoRetainedAflTablesResultsNormalizationFailure(client)).rejects.toThrow(
      /preserve it and use a fresh explicitly authorized capture rehearsal/i
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('outcome_provider_normalization_attempt');
    expect(statements[0]).toContain('run.finalized_at IS NOT NULL');
  });
});
