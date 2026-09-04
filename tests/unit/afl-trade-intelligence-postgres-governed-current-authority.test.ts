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
  it('uses private prepared-v3 authority instead of the public factual registry', async () => {
    const calls: string[] = [];
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
        calls.push(sql);
        if (sql.includes('SET LOCAL ROLE') || sql.includes('RESET ROLE')) {
          return { rows: [], rowCount: null };
        }
        if (sql.includes('load_outcome_private_prepared_v3_authority')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    await expect(
      capturePostgresGovernedPrivateEvaluationCurrentAuthority({
        transaction,
        selector: {
          valuationScopeKey: 'afl-men:2026-trades',
          tradeId: 'trade:fixture',
        },
        capturedAt: '2026-08-20T10:00:00.000Z',
        prepared: {
          preparationAuthority: 'qualified_current_model_evidence',
          factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
          factualReleaseId: `outcome-release:${'1'.repeat(64)}`,
          factualReleaseArtifact: {} as never,
          releaseMembershipArtifact: {} as never,
          preparationOperationId: `valuation-cohort-preparation-operation:${'2'.repeat(64)}`,
          modelEvidence: {
            operationId: `current-valuation-model-evidence-operation:${'3'.repeat(64)}`,
          } as never,
          dispatchAuthority: {
            requestId: `private-valuation-dispatch:${'4'.repeat(64)}`,
            factualOutputId: `private-valuation-factual-output:${'5'.repeat(64)}`,
            hpnCalculationId: `hpn-pav-season:${'6'.repeat(64)}`,
            modelOperationId: `private-valuation-model-operation:${'7'.repeat(64)}`,
          },
        },
        trace: {} as never,
        materializationManifestId: `private-evaluation-materialization-manifest:${'8'.repeat(64)}`,
        materializationManifestArtifact: {} as never,
        valuationInputBundleId: `valuation-input-bundle:${'9'.repeat(64)}`,
        valuationInputBundleArtifact: {} as never,
        preparedInputHeadRevision: 1,
        preparedInputSetId: `prepared-valuation-input-set:${'a'.repeat(64)}`,
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
          message: 'The exact private prepared authority is no longer current.',
        },
      ],
    });
    expect(calls.some((sql) => sql.includes('FROM outcome_registry_head'))).toBe(false);
  });

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
          preparationAuthority: 'authenticated_calculation_evidence_snapshot',
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
          message:
            'No current authorized private derived-calculation decision covers this release.',
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
