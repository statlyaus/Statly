import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  capturePostgresGovernedPrivateEvaluationCurrentAuthority,
  loadCurrentGovernedComponentAuthority,
  loadCurrentPrivateValuationDecision,
} from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationCurrentAuthority';

class InactiveFactualAuthorityTransaction implements AflOutcomeSqlTransaction {
  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (!sql.includes('FROM outcome_registry_head')) {
      throw new Error(`Unexpected SQL: ${sql} ${JSON.stringify(parameters)}`);
    }
    return {
      rows: [
        {
          revision: 0,
          last_event_id: null,
          registry_json: { revision: 0, releases: {}, activeByScope: {}, events: [] },
          active_release_id: null,
          active_revision: null,
          activated_at: null,
        },
      ] as Row[],
      rowCount: 1,
    };
  }
}

describe('PostgreSQL governed current calculation authority', () => {
  it('fails closed when the prepared factual release is no longer active', async () => {
    await expect(
      capturePostgresGovernedPrivateEvaluationCurrentAuthority({
        transaction: new InactiveFactualAuthorityTransaction(),
        selector: {
          valuationScopeKey: 'afl-men:2026-trades',
          tradeId: 'trade:fixture',
        },
        capturedAt: '2026-08-20T10:00:00.000Z',
        prepared: {
          factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
          factualReleaseId: `outcome-release:${'1'.repeat(64)}`,
          factualReleaseArtifact: {} as never,
          releaseMembershipArtifact: {} as never,
          sourceQualificationEvidenceRefs: [],
        },
        trace: {} as never,
        materializationManifestId: `private-evaluation-materialization-manifest:${'2'.repeat(64)}`,
        materializationManifestArtifact: {} as never,
        valuationInputBundleId: `valuation-input-bundle:${'3'.repeat(64)}`,
        valuationInputBundleArtifact: {} as never,
        preparedInputHeadRevision: 1,
        preparedInputSetId: `prepared-valuation-input-set:${'4'.repeat(64)}`,
        artifactRepository: createAflTradeFixtureArtifactRepository({
          artifactClass: 'derived_private',
        }),
        maximumArtifactBytes: 1024 * 1024,
      })
    ).resolves.toEqual({
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message: 'The exact prepared factual release is not the current active release.',
        },
      ],
    });
  });

  it('fails closed when no current private derived-calculation decision exists', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
        if (!sql.includes('FROM outcome_private_valuation_evaluation_head')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await expect(
      loadCurrentPrivateValuationDecision(transaction, {
        valuationScopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
        factualReleaseId: `outcome-release:${'1'.repeat(64)}`,
        factualReleaseArtifact: {} as never,
        releaseMembershipArtifact: {} as never,
        sourceQualificationEvidenceRefs: [],
      })
    ).resolves.toEqual({
      state: 'unavailable',
      blockers: [
        {
          code: 'source_blocked',
          message: 'No current authorized private derived-calculation decision covers this release.',
        },
      ],
    });
  });

  it('keeps model authority unavailable when the Gate ledger has no decisions', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
        if (!sql.includes('FROM outcome_gate_ledger_head')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        return { rows: [{ revision: 0 }] as Row[], rowCount: 1 };
      },
    };

    await expect(
      loadCurrentGovernedComponentAuthority({
        transaction,
        trace: {} as never,
        capturedAt: '2026-08-20T10:00:00.000Z',
        artifactRepository: createAflTradeFixtureArtifactRepository({
          artifactClass: 'derived_private',
        }),
        maximumArtifactBytes: 1024 * 1024,
      })
    ).resolves.toEqual({
      state: 'unavailable',
      blockers: [
        {
          code: 'model_not_approved',
          message:
            'The exact current automated qualification is unavailable for both governed model components.',
        },
      ],
    });
  });
});
