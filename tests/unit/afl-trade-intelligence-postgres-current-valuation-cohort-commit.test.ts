import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createPostgresAflTradeCurrentValuationCohortAuthorityCapture,
  createPostgresAflTradeCurrentValuationCohortCommitter,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation';
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
    if (sql.includes('INSERT INTO outcome_current_valuation_cohort_operation')) {
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
        rows: [{
          revision: this.modelRevision,
          qualification_id: `model-qualification:${'8'.repeat(64)}`,
          player_run_id: `model-run:${'9'.repeat(64)}`,
          pick_run_id: `model-run:${'a'.repeat(64)}`,
          work_id: `model-qualification-work:${'0'.repeat(64)}`,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return {
        rows: [{
          scope_key: 'afl-men:2026-trades',
          prepared_input_set_id:
            this.activatedPreparedInputSetId ??
            `prepared-valuation-input-set:${'f'.repeat(64)}`,
          revision: this.activated ? 12 : 11,
          activated_at: '2026-08-21T09:00:00.000Z',
        }],
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
      return { rows: [{}], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    const result =
      this.operationResultQuery(sql, parameters) ??
      this.currentAuthorityQuery(sql) ??
      this.activationQuery(sql, parameters);
    if (result !== null) return result as AflOutcomeSqlQueryResult<Row>;
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgreSQL current valuation cohort commit', () => {
  it('captures one exact factual, model, and prepared-head authority snapshot', async () => {
    const fixture = createAflTradeCurrentValuationCohortFixture();
    const transaction = new CommitTransaction();
    const capture = createPostgresAflTradeCurrentValuationCohortAuthorityCapture({
      client: { query: transaction.query.bind(transaction), transaction: async (work) => work(transaction) },
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
      client: { query: transaction.query.bind(transaction), transaction: async (work) => work(transaction) },
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
