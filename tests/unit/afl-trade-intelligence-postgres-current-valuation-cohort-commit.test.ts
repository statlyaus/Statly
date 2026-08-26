import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createPostgresAflTradeCurrentValuationCohortAuthorityCapture,
  createPostgresAflTradeCurrentValuationCohortCommitter,
  createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture,
  createPostgresAflTradePrivateCurrentValuationCohortCommitter,
  loadPostgresAflTradePrivateCurrentPreparedValuationCohort,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation';
import { createAflTradePrivateCurrentValuationCohortPreparationOperationId } from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
import { createAflTradePreparedValuationInputSet } from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import { createAflTradeCurrentValuationCohortFixture } from '../testUtils/currentValuationCohortFixture';

class CommitTransaction implements AflOutcomeSqlTransaction {
  modelRevision = 3;
  activated = false;
  activatedPreparedInputSetId: string | null = null;
  retainedContext: unknown | null = null;
  retainedResult: { prepared_input_set_id: string; head_revision: number } | null = null;

  private operationResultQuery(
    sql: string,
    parameters: readonly unknown[] = []
  ): AflOutcomeSqlQueryResult<unknown> | null {
    if (sql.includes('FROM outcome_current_valuation_cohort_operation_result')) {
      return {
        rows: this.retainedResult === null ? [] : [this.retainedResult],
        rowCount: this.retainedResult === null ? 0 : 1,
      };
    }
    if (sql.includes('FROM outcome_current_valuation_cohort_operation')) {
      return {
        rows: this.retainedContext === null ? [] : [{ context_json: this.retainedContext }],
        rowCount: this.retainedContext === null ? 0 : 1,
      };
    }
    if (sql.includes('INSERT INTO outcome_current_valuation_cohort_operation_result')) {
      this.retainedResult = {
        prepared_input_set_id: String(parameters[1]),
        head_revision: Number(parameters[2]),
      };
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO outcome_current_valuation_cohort_operation\s*\(/u.test(sql)) {
      this.retainedContext = JSON.parse(String(parameters[11]));
      return { rows: [], rowCount: 1 };
    }
    return null;
  }

  private currentAuthorityQuery(sql: string): AflOutcomeSqlQueryResult<unknown> | null {
    if (sql.includes('transaction_timestamp()')) {
      return { rows: [{ captured_at: '2026-08-21T09:00:00.000Z' }], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_active_release')) {
      return {
        rows: [{ release_id: `outcome-release:${'2'.repeat(64)}`, revision: 7 }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_current_governed_valuation_model_pair')) {
      return {
        rows: [
          {
            revision: this.modelRevision,
            qualification_id: `model-qualification:${'8'.repeat(64)}`,
            player_run_id: `model-run:${'9'.repeat(64)}`,
            pick_run_id: `model-run:${'a'.repeat(64)}`,
            work_id: `model-qualification-work:${'0'.repeat(64)}`,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return {
        rows: [
          {
            scope_key: 'afl-men:2026-trades',
            prepared_input_set_id:
              this.activatedPreparedInputSetId ?? `prepared-valuation-input-set:${'f'.repeat(64)}`,
            revision: this.activated ? 12 : 11,
            activated_at: '2026-08-21T09:00:00.000Z',
          },
        ],
        rowCount: 1,
      };
    }
    return null;
  }

  private activationQuery(
    sql: string,
    parameters: readonly unknown[]
  ): AflOutcomeSqlQueryResult<unknown> | null {
    if (!sql.includes('activate_outcome_current_prepared_valuation_input_set')) return null;
    this.activated = true;
    this.activatedPreparedInputSetId = String(parameters[1]);
    return {
      rows: [{ activate_outcome_current_prepared_valuation_input_set: 12 }],
      rowCount: 1,
    };
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL')) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) {
      return { rows: [{}], rowCount: 1 } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    const result =
      this.operationResultQuery(sql, parameters) ??
      this.currentAuthorityQuery(sql) ??
      this.activationQuery(sql, parameters);
    if (result !== null) return result as AflOutcomeSqlQueryResult<Row>;
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class PrivateCaptureTransaction implements AflOutcomeSqlTransaction {
  capturedAt = '2026-08-21T09:00:00.000Z';
  claimValidated = false;
  retainedContext: unknown | null = null;
  retainedResult: { prepared_input_set_id: string; head_revision: number } | null = null;
  activatedPreparedInputSetId: string | null = null;
  currentPreparedInputSet: unknown | null = null;

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL')) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) {
      return { rows: [{}], rowCount: 1 } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
      this.claimValidated = true;
      return { rows: [{}], rowCount: 1 } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('transaction_timestamp()')) {
      return {
        rows: [{ captured_at: this.capturedAt }],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_private_valuation_model_request_binding')) {
      return {
        rows: [
          {
            scope_key: 'afl-men:2026-trades',
            factual_release_scope_key: 'private-afl-draft-trade-outcomes',
            factual_release_id: `outcome-release:${'6'.repeat(64)}`,
            factual_output_id: `private-valuation-factual-output:${'1'.repeat(64)}`,
            hpn_calculation_id: `hpn-pav-season:${'2'.repeat(64)}`,
            model_operation_id: `private-valuation-model-operation:${'3'.repeat(64)}`,
            model_qualification_id: `model-qualification:${'8'.repeat(64)}`,
            model_qualification_work_id: `model-qualification-work:${'4'.repeat(64)}`,
            model_qualification_revision: 3,
            player_run_id: `model-run:${'9'.repeat(64)}`,
            pick_run_id: `model-run:${'a'.repeat(64)}`,
          },
        ],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('prepared.prepared_set_json AS prepared_set_json')) {
      return {
        rows:
          this.currentPreparedInputSet === null
            ? []
            : [
                {
                  scope_key: 'afl-men:2026-trades',
                  prepared_input_set_id: this.activatedPreparedInputSetId,
                  revision: 12,
                  activated_at: '2026-08-21T09:00:00.000Z',
                  prepared_set_json: this.currentPreparedInputSet,
                },
              ],
        rowCount: this.currentPreparedInputSet === null ? 0 : 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return {
        rows: [
          {
            scope_key: 'afl-men:2026-trades',
            prepared_input_set_id:
              this.activatedPreparedInputSetId ?? `prepared-valuation-input-set:${'f'.repeat(64)}`,
            revision: this.activatedPreparedInputSetId === null ? 11 : 12,
            activated_at: '2026-08-21T09:00:00.000Z',
          },
        ],
        rowCount: 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_current_valuation_cohort_operation_result')) {
      return {
        rows: this.retainedResult === null ? [] : [this.retainedResult],
        rowCount: this.retainedResult === null ? 0 : 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_current_valuation_cohort_operation')) {
      return {
        rows: this.retainedContext === null ? [] : [{ context_json: this.retainedContext }],
        rowCount: this.retainedContext === null ? 0 : 1,
      } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (/INSERT INTO outcome_current_valuation_cohort_operation\s*\(/u.test(sql)) {
      this.retainedContext = JSON.parse(String(parameters[10]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('activate_outcome_current_prepared_valuation_input_set')) {
      this.activatedPreparedInputSetId = String(parameters[1]);
      return { rows: [{}], rowCount: 1 } as unknown as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('INSERT INTO outcome_current_valuation_cohort_operation_result')) {
      this.retainedResult = {
        prepared_input_set_id: String(parameters[1]),
        head_revision: Number(parameters[2]),
      };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgreSQL current valuation cohort commit', () => {
  it('captures exact private factual, dispatch, model, bundle, and prepared-head authority', async () => {
    const transaction = new PrivateCaptureTransaction();
    const bundle = createAflTradeCurrentValuationCohortFixture().valuationInputBundle;
    const privateAuthority = {
      dispatchRequestId: `private-valuation-dispatch:${'0'.repeat(64)}`,
      factualOutputId: `private-valuation-factual-output:${'1'.repeat(64)}`,
      hpnCalculationId: `hpn-pav-season:${'2'.repeat(64)}`,
      modelOperationId: `private-valuation-model-operation:${'3'.repeat(64)}`,
      modelQualificationId: `model-qualification:${'8'.repeat(64)}`,
      modelQualificationWorkId: `model-qualification-work:${'4'.repeat(64)}`,
      modelQualificationRevision: 3,
      playerRunId: `model-run:${'9'.repeat(64)}`,
      pickRunId: `model-run:${'a'.repeat(64)}`,
    } as const;
    const capture = createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture({
      client: {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      },
      loadConstructionEvidence: async () => ({
        factualReleaseArtifact: {
          artifactId: `artifact:${'b'.repeat(64)}`,
          contentSha256: 'b'.repeat(64),
          storageUri: `artifact://sha256/${'b'.repeat(64)}`,
          mediaType: 'application/json',
          byteLength: 256,
          createdAt: '2026-08-21T08:00:00.000Z',
        },
        releaseMembershipArtifact: {
          artifactId: `artifact:${'c'.repeat(64)}`,
          contentSha256: 'c'.repeat(64),
          storageUri: `artifact://sha256/${'c'.repeat(64)}`,
          mediaType: 'application/json',
          byteLength: 256,
          createdAt: '2026-08-21T08:00:00.000Z',
        },
        releaseTradeIds: ['trade-a'],
        valuationInputBundleId: bundle.valuationInputBundleId,
        valuationInputBundleArtifact:
          createAflTradeCurrentValuationCohortFixture().context.valuationInputBundleArtifact,
        valuationInputBundle: bundle,
      }),
    });

    const context = await capture({
      requestId: privateAuthority.dispatchRequestId,
      claim: {
        claimId: `private-valuation-dispatch-claim:${'d'.repeat(64)}`,
        leaseToken: 'e'.repeat(64),
      },
    });

    expect(context).toMatchObject({
      operationId: createAflTradePrivateCurrentValuationCohortPreparationOperationId({
        scopeKey: 'afl-men:2026-trades',
        factualReleaseId: `outcome-release:${'6'.repeat(64)}`,
        privateAuthority,
        valuationInputBundleId: bundle.valuationInputBundleId,
        expectedPreparedInputRevision: 11,
      }),
      preparationAuthority: 'dispatch_bound_private_factual_output',
      privateAuthority,
      expectedPreparedInputRevision: 11,
    });
    transaction.capturedAt = '2026-08-21T09:05:00.000Z';
    await expect(
      capture({
        requestId: privateAuthority.dispatchRequestId,
        claim: {
          claimId: `private-valuation-dispatch-claim:${'d'.repeat(64)}`,
          leaseToken: 'e'.repeat(64),
        },
      })
    ).resolves.toEqual(context);

    const preparedInputSet = createAflTradePreparedValuationInputSet({
      schemaVersion: 'afl-trade-prepared-valuation-input-set/v3',
      environment: 'non_production',
      scopeKey: context.scopeKey,
      factualReleaseScopeKey: context.factualReleaseScopeKey,
      factualReleaseId: context.factualReleaseId,
      factualReleaseArtifact: context.factualReleaseArtifact,
      releaseMembershipArtifact: context.releaseMembershipArtifact,
      preparationAuthority: 'dispatch_bound_private_factual_output',
      preparationOperationId: context.operationId,
      qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
      privateAuthority: context.privateAuthority,
      valuationInputBundleId: context.valuationInputBundleId,
      valuationInputBundleArtifact: context.valuationInputBundleArtifact,
      releaseTradeIds: context.releaseTradeIds,
      entries: [
        {
          tradeId: 'trade-a',
          state: 'blocked',
          blockers: [
            {
              code: 'component_output_unavailable',
              subject: { kind: 'trade', id: 'trade-a' },
              evidenceRefs: [context.valuationInputBundleArtifact],
            },
          ],
        },
      ],
      tradeCount: 1,
      readyCount: 0,
      blockedCount: 1,
      preparedAt: context.capturedAt,
      publicationEligible: false,
      limitation:
        'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
    });
    transaction.claimValidated = false;
    const commit = createPostgresAflTradePrivateCurrentValuationCohortCommitter({
      client: {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      },
      registerPreparedInputSet: async () => {
        expect(transaction.claimValidated).toBe(true);
        return preparedInputSet;
      },
    });

    await expect(
      commit({
        context,
        preparedInputSet,
        claim: {
          claimId: `private-valuation-dispatch-claim:${'d'.repeat(64)}`,
          leaseToken: 'e'.repeat(64),
        },
      })
    ).resolves.toMatchObject({ state: 'advanced', head: { revision: 12 } });

    transaction.currentPreparedInputSet = preparedInputSet;
    await expect(
      loadPostgresAflTradePrivateCurrentPreparedValuationCohort({
        client: {
          query: transaction.query.bind(transaction),
          transaction: async (work) => work(transaction),
        },
        requestId: privateAuthority.dispatchRequestId,
        claim: {
          claimId: `private-valuation-dispatch-claim:${'d'.repeat(64)}`,
          leaseToken: 'e'.repeat(64),
        },
      })
    ).resolves.toMatchObject({
      state: 'already_current',
      preparedInputSet: { preparedInputSetId: preparedInputSet.preparedInputSetId },
      head: { revision: 12 },
    });
    await expect(
      loadPostgresAflTradePrivateCurrentPreparedValuationCohort({
        client: {
          query: transaction.query.bind(transaction),
          transaction: async (work) => work(transaction),
        },
        requestId: `private-valuation-dispatch:${'f'.repeat(64)}`,
        claim: {
          claimId: `private-valuation-dispatch-claim:${'d'.repeat(64)}`,
          leaseToken: 'e'.repeat(64),
        },
      })
    ).resolves.toMatchObject({
      state: 'already_current',
      preparedInputSet: { preparedInputSetId: preparedInputSet.preparedInputSetId },
    });
  });

  it('captures one exact factual, model, and prepared-head authority snapshot', async () => {
    const fixture = createAflTradeCurrentValuationCohortFixture();
    const transaction = new CommitTransaction();
    const capture = createPostgresAflTradeCurrentValuationCohortAuthorityCapture({
      client: {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      },
      factualReleaseScopeKey: fixture.context.factualReleaseScopeKey,
      loadConstructionEvidence: async () => ({
        factualReleaseArtifact: fixture.context.factualReleaseArtifact,
        releaseMembershipArtifact: fixture.context.releaseMembershipArtifact,
        releaseTradeIds: fixture.context.releaseTradeIds,
        sourceQualificationReportId: fixture.context.sourceQualificationReportId,
        sourceQualificationReportArtifact: fixture.context.sourceQualificationReportArtifact,
        sourceQualificationEvidenceRefs: fixture.context.sourceQualificationEvidenceRefs,
        valuationInputBundleId: fixture.context.valuationInputBundleId,
        valuationInputBundleArtifact: fixture.context.valuationInputBundleArtifact,
        valuationInputBundle: fixture.valuationInputBundle,
      }),
    });

    const request = {
      operationId: fixture.context.operationId,
      scopeKey: fixture.context.scopeKey,
    };
    await expect(capture(request)).resolves.toEqual(fixture.context);
    transaction.activated = true;
    await expect(capture(request)).resolves.toEqual(fixture.context);
  });

  it('recaptures exact factual and qualified-model authority before advancing', async () => {
    const fixture = createAflTradeCurrentValuationCohortFixture();
    const transaction = new CommitTransaction();
    const commit = createPostgresAflTradeCurrentValuationCohortCommitter({
      client: {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      },
      registerPreparedInputSet: async () => fixture.preparedInputSet,
    });

    await expect(commit(fixture.commitInput)).resolves.toMatchObject({
      state: 'advanced',
      head: { revision: 12 },
    });
    expect(transaction.activated).toBe(true);

    transaction.modelRevision = 4;
    transaction.activated = false;
    await expect(commit(fixture.commitInput)).resolves.toEqual({
      state: 'stale_authority',
      reason: 'The qualified model pair changed while the cohort was being prepared.',
    });
    expect(transaction.activated).toBe(false);
  });
});
