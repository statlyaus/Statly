import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  capturePostgresGovernedPrivateEvaluationCurrentAuthority,
  loadPostgresAflTradePrivateCurrentValuationCohortAuthority,
  loadCurrentGovernedComponentAuthority,
  loadCurrentPrivateValuationDecision,
} from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationCurrentAuthority';

const privateAuthority = {
  dispatchRequestId: `private-valuation-dispatch:${'1'.repeat(64)}`,
  factualOutputId: `private-valuation-factual-output:${'2'.repeat(64)}`,
  hpnCalculationId: `hpn-pav-season:${'3'.repeat(64)}`,
  modelOperationId: `private-valuation-model-operation:${'4'.repeat(64)}`,
  modelQualificationId: `model-qualification:${'5'.repeat(64)}`,
  modelQualificationWorkId: `model-qualification-work:${'6'.repeat(64)}`,
  modelQualificationRevision: 7,
  playerRunId: `model-run:${'7'.repeat(64)}`,
  pickRunId: `model-run:${'8'.repeat(64)}`,
} as const;

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
  it('authenticates the exact dispatch-bound private factual and current model tuple', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string, parameters = []): Promise<AflOutcomeSqlQueryResult<Row>> {
        if (!sql.includes('FROM outcome_private_valuation_model_request_binding')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        expect(parameters).toEqual([privateAuthority.dispatchRequestId]);
        return {
          rows: [
            {
              scope_key: 'afl-men:2026-trades',
              factual_release_scope_key: 'private-afl-draft-trade-outcomes',
              factual_release_id: `outcome-release:${'9'.repeat(64)}`,
              factual_output_id: privateAuthority.factualOutputId,
              hpn_calculation_id: privateAuthority.hpnCalculationId,
              model_operation_id: privateAuthority.modelOperationId,
              model_qualification_id: privateAuthority.modelQualificationId,
              model_qualification_work_id: privateAuthority.modelQualificationWorkId,
              model_qualification_revision: privateAuthority.modelQualificationRevision,
              player_run_id: privateAuthority.playerRunId,
              pick_run_id: privateAuthority.pickRunId,
            },
          ] as Row[],
          rowCount: 1,
        };
      },
    };

    await expect(
      loadPostgresAflTradePrivateCurrentValuationCohortAuthority(transaction, {
        scopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
        factualReleaseId: `outcome-release:${'9'.repeat(64)}`,
        privateAuthority,
      })
    ).resolves.toBe(true);
  });

  it('rejects a superseded dispatch-bound model-pair work revision', async () => {
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
        return {
          rows: [
            {
              scope_key: 'afl-men:2026-trades',
              factual_release_scope_key: 'private-afl-draft-trade-outcomes',
              factual_release_id: `outcome-release:${'9'.repeat(64)}`,
              factual_output_id: privateAuthority.factualOutputId,
              hpn_calculation_id: privateAuthority.hpnCalculationId,
              model_operation_id: privateAuthority.modelOperationId,
              model_qualification_id: privateAuthority.modelQualificationId,
              model_qualification_work_id: privateAuthority.modelQualificationWorkId,
              model_qualification_revision: privateAuthority.modelQualificationRevision + 1,
              player_run_id: privateAuthority.playerRunId,
              pick_run_id: privateAuthority.pickRunId,
            },
          ] as Row[],
          rowCount: 1,
        };
      },
    };

    await expect(
      loadPostgresAflTradePrivateCurrentValuationCohortAuthority(transaction, {
        scopeKey: 'afl-men:2026-trades',
        factualReleaseScopeKey: 'private-afl-draft-trade-outcomes',
        factualReleaseId: `outcome-release:${'9'.repeat(64)}`,
        privateAuthority,
      })
    ).resolves.toBe(false);
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
