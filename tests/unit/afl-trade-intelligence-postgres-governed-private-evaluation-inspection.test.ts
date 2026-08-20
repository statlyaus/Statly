import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresGovernedPrivateEvaluationInspectionRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationInspectionRepository';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const capturedAt = '2026-08-19T10:00:00.000Z';
const generationId = `local-private-trade-evaluation-generation:${'a'.repeat(64)}`;
const transitionId = `private-evaluation-transition:${'b'.repeat(64)}`;

class InspectionSqlClient implements AflOutcomeSqlClient {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    if (sql.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')) {
      return { rows: [], rowCount: null };
    }
    if (sql.includes('transaction_timestamp()')) {
      return {
        rows: [{ trusted_at: new Date(capturedAt) }],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
      return {
        rows: [
          {
            status: 'active',
            revision: 4,
            generation_id: generationId,
            last_transition_id: transitionId,
          },
        ],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('INSERT INTO outcome_private_evaluation_authority_snapshot')) {
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('INSERT INTO outcome_private_evaluation_inspection_receipt')) {
      return { rows: [], rowCount: 1 } as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

describe('PostgreSQL governed private evaluation inspection repository', () => {
  it('retains one repeatable-read unavailable inspection with the exact active head', async () => {
    const client = new InspectionSqlClient();
    const retained: { reference: AflTradeArtifactRef; bytes: Uint8Array }[] = [];
    const repository = createPostgresGovernedPrivateEvaluationInspectionRepository({
      client,
      retainArtifact: async (artifact) => {
        retained.push(artifact);
        return artifact.reference;
      },
      validityMilliseconds: 5 * 60 * 1_000,
    });

    await expect(repository.inspect(selector)).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'active', revision: 4, generationId },
      blockers: [{ code: 'model_not_approved' }],
    });
    expect(retained).toHaveLength(2);
    const retainedDocuments = retained.map(({ bytes }) =>
      JSON.parse(new TextDecoder().decode(bytes))
    );
    expect(retainedDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            schemaVersion: 'private-evaluation-authority-snapshot/v3',
            environment: 'non_production',
            calculationAuthority: expect.objectContaining({ state: 'unavailable' }),
            blockers: [expect.objectContaining({ code: 'model_not_approved' })],
          }),
        }),
        expect.objectContaining({
          content: expect.objectContaining({
            schemaVersion: 'private-evaluation-inspection/v3',
            environment: 'non_production',
            state: 'unavailable',
          }),
        }),
      ])
    );
    const firstInsert = client.calls.findIndex((call) =>
      call.sql.includes('INSERT INTO outcome_private_evaluation_authority_snapshot')
    );
    expect(firstInsert).toBeGreaterThan(-1);
    expect(
      client.calls.some((call) =>
        call.sql.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      )
    ).toBe(true);
    expect(
      client.calls.find((call) =>
        call.sql.includes('FROM outcome_local_private_trade_evaluation_head')
      )?.parameters
    ).toEqual([selector.valuationScopeKey, selector.tradeId]);
    expect(
      client.calls.some((call) =>
        call.sql.includes('INSERT INTO outcome_private_evaluation_inspection_receipt')
      )
    ).toBe(true);
  });

  it('retains ready v3 authority captured inside the same repeatable-read transaction', async () => {
    const client = new InspectionSqlClient();
    const retained: { reference: AflTradeArtifactRef; bytes: Uint8Array }[] = [];
    const addressed = (prefix: string, label: string) =>
      createAflTradeContentAddress(prefix, { fixture: label });
    const manifestArtifact = createAflTradeCanonicalJsonArtifactRef(
      { kind: 'materialization-manifest' },
      '2026-08-19T09:00:00.000Z'
    );
    const bundleArtifact = createAflTradeCanonicalJsonArtifactRef(
      { kind: 'valuation-input-bundle' },
      '2026-08-19T09:00:00.000Z'
    );
    const qualificationId = addressed('model-qualification', 'qualification');
    const qualificationPolicyVersion = addressed(
      'model-qualification-policy',
      'qualification-policy'
    );
    const components = [
      'player_contribution_and_availability',
      'draft_pick_and_future_pick_distribution',
    ].map((role, index) => ({
      role: role as
        | 'player_contribution_and_availability'
        | 'draft_pick_and_future_pick_distribution',
      runId: addressed('model-run', `run-${index}`),
      protocolId: addressed('model-protocol', `protocol-${index}`),
      datasetId: addressed('dataset', `dataset-${index}`),
      datasetAdmissionId: addressed('dataset-admission', `admission-${index}`),
      datasetAdmissionGateLedgerRevision: 10 + index,
      gate3DecisionId: addressed('gate-decision', `gate-${index}`),
      gate3DecisionVersion: 2,
      qualificationId,
      qualificationPolicyVersion,
    }));
    let captureTransaction: AflOutcomeSqlTransaction | null = null;
    const repository = createPostgresGovernedPrivateEvaluationInspectionRepository({
      client,
      retainArtifact: async (artifact) => {
        retained.push(artifact);
        return artifact.reference;
      },
      captureCalculationAuthority: async (input) => {
        captureTransaction = input.transaction;
        expect(input.selector).toEqual(selector);
        expect(input.capturedAt).toBe(capturedAt);
        return {
          state: 'ready' as const,
          preparedInputHeadRevision: 4,
          preparedInputSetId: addressed('prepared-valuation-input-set', 'prepared'),
          factualRegistryRevision: 20,
          factualReleaseId: addressed('outcome-release', 'release'),
          activeFactualReleaseRevision: 18,
          privateValuationDecisionId: addressed(
            'private-valuation-evaluation-decision',
            'private-decision'
          ),
          privateValuationDecisionRevision: 3,
          materializationManifestId: addressed(
            'private-evaluation-materialization-manifest',
            'manifest'
          ),
          materializationManifestArtifact: manifestArtifact,
          valuationInputBundleId: addressed('valuation-input-bundle', 'bundle'),
          valuationInputBundleArtifact: bundleArtifact,
          gateLedgerRevision: 24,
          components,
        };
      },
      validityMilliseconds: 5 * 60 * 1_000,
    });

    await expect(repository.inspect(selector)).resolves.toMatchObject({
      state: 'ready',
      selector,
      head: { status: 'active', revision: 4, generationId },
      blockers: [],
    });
    expect(captureTransaction).toBe(client);
    expect(retained).toHaveLength(2);
    const documents = retained.map(({ bytes }) =>
      JSON.parse(new TextDecoder().decode(bytes))
    );
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            schemaVersion: 'private-evaluation-authority-snapshot/v3',
            calculationAuthority: expect.objectContaining({
              state: 'ready',
              factualRegistryRevision: 20,
              privateValuationDecisionRevision: 3,
              components,
            }),
          }),
        }),
        expect.objectContaining({
          content: expect.objectContaining({
            schemaVersion: 'private-evaluation-inspection/v3',
            state: 'ready',
          }),
        }),
      ])
    );
    const inspectionInsert = client.calls.find((call) =>
      call.sql.includes('INSERT INTO outcome_private_evaluation_inspection_receipt')
    );
    expect(inspectionInsert?.parameters).toContain('ready');
  });
});
