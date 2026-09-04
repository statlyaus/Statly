import { describe, expect, it, vi } from 'vitest';

const provenance = vi.hoisted(() => ({
  hasCurrent: vi.fn<() => Promise<boolean>>(),
}));

vi.mock(
  '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetFactualLineageRepository',
  () => ({
    hasCurrentAflTradeValuationDatasetDomainProvenance: provenance.hasCurrent,
  })
);

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeModelRunAuthorizationSchema,
  type AflTradeModelRunAuthorization,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import {
  AflTradeModelRunPersistenceError,
  PostgresAflTradeAdmittedModelRunAuthority,
} from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';

import { admittedRunFixture, digest } from '../testUtils/admittedPlayerModelRunFixture';

function authorization(
  fixture: ReturnType<typeof admittedRunFixture>
): AflTradeModelRunAuthorization {
  const content = {
    schemaVersion: 'afl-trade-model-run-authorization/v1' as const,
    authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: fixture.intent.content.environment,
    runIntentId: fixture.intent.intentId,
    datasetId: fixture.intent.content.datasetId,
    datasetAdmissionId: fixture.intent.content.datasetAdmissionId,
    datasetRowSetSha256: fixture.observationSet.content.datasetRowSetSha256,
    modelProtocolId: fixture.intent.content.modelProtocolId,
    observationSetId: fixture.intent.content.observationSetId,
    operationalAuthorizationReceiptId: fixture.operationalAuthorization.receiptId,
    gate2DecisionId: `gate-decision:${digest('f')}`,
    gateLedgerRevision: fixture.evidence.gateLedgerRevision,
    authorizedAt: fixture.intent.content.startedAt,
    validThrough: new Date(
      Date.parse(fixture.intent.content.startedAt) + 60_000
    ).toISOString(),
    modelTrainingEvaluationReceiptIds: fixture.intent.content.modelTrainingEvaluationReceiptIds,
  };
  return aflTradeModelRunAuthorizationSchema.parse({
    authorizationId: createAflTradeContentAddress('model-run-authorization', content),
    content,
  });
}

function dependencies(sql: unknown) {
  return {
    sql: sql as never,
    gateDecisionLedgerRepository: {} as never,
    artifactRepository: {} as never,
  };
}

describe('PostgresAflTradeAdmittedModelRunAuthority current provenance', () => {
  it('rejects evidence authentication before reading downstream evidence when promotion is stale', async () => {
    provenance.hasCurrent.mockResolvedValueOnce(false);
    const fixture = admittedRunFixture();
    const query = vi.fn(async () => ({
      rows: [
        {
          protocol_json: fixture.protocol,
          observation_json: fixture.observationSet,
          admission_json: fixture.admission,
          dataset_json: fixture.datasetCandidate,
          gate2_decision_key: fixture.evidence.gate2DecisionKey,
          operational_authorization_json: fixture.operationalAuthorization,
        },
      ],
      rowCount: 1,
    }));
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority(
      dependencies({ query, transaction: vi.fn() })
    );

    await expect(adapter.authenticate({ intent: fixture.intent })).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
      message: 'Model-run authority requires current canonical-promotion provenance.',
    } satisfies Partial<AflTradeModelRunPersistenceError>);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('allows issuance only while provenance is current and blocks consumption after it changes', async () => {
    provenance.hasCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fixture = admittedRunFixture();
    const runAuthorization = authorization(fixture);
    const transactionQuery = vi.fn(async (statement: string) => {
      if (statement.includes('INSERT INTO outcome_valuation_model_run_authorization')) {
        return { rows: [], rowCount: 1 };
      }
      if (statement.includes('FROM outcome_valuation_model_run_intent intent')) {
        return {
          rows: [
            {
              factual_candidate_id:
                fixture.datasetCandidate.content.factualParent.factualCandidateId,
              lineage_id:
                fixture.datasetCandidate.content.factualParent.corpusToCandidateLineageId,
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes('FROM outcome_gate_ledger_head')) {
        return { rows: [{ revision: runAuthorization.content.gateLedgerRevision }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const transaction = vi.fn(async (work: (value: unknown) => Promise<unknown>) =>
      work({ query: transactionQuery })
    );
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority(
      dependencies({ query: vi.fn(), transaction })
    );

    await expect(
      adapter.issueOnceForIntent({ authorization: runAuthorization, intent: fixture.intent })
    ).resolves.toBe(true);
    await expect(
      adapter.consumeIntentOnce({
        authorizationId: runAuthorization.authorizationId,
        intentId: fixture.intent.intentId,
        consumedAt: fixture.intent.content.startedAt,
      })
    ).resolves.toBe(false);
    expect(
      transactionQuery.mock.calls.some(([statement]) =>
        String(statement).includes('UPDATE outcome_valuation_model_run_authorization')
      )
    ).toBe(false);
    expect(provenance.hasCurrent).toHaveBeenCalledTimes(2);
  });
});
