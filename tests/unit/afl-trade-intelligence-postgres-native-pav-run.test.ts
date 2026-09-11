import { describe, expect, it } from 'vitest';

import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';

describe('PostgreSQL native PAV run preparation', () => {
  it('reauthenticates native source evidence inside the consumption transaction', async () => {
    const fixture = await admittedPavModelRunFixture();
    let inTransaction = false;
    const sql: AflOutcomeSqlClient = {
      query: (async (statement: string) => {
        if (!inTransaction) throw new Error('Consumption checks escaped the transaction.');
        if (/UPDATE/.test(statement)) throw new Error('Must not consume missing native evidence.');
        const rows = statement.includes('SELECT dataset.factual_candidate_id')
          ? [
              {
                factual_candidate_id:
                  fixture.evidence.datasetCandidate.content.factualParent.factualCandidateId,
                lineage_id:
                  fixture.evidence.datasetCandidate.content.factualParent
                    .corpusToCandidateLineageId,
                protocol_json: fixture.protocol,
                observation_json: fixture.observationSet,
                admission_json: fixture.admission,
                dataset_json: fixture.evidence.datasetCandidate,
              },
            ]
          : [];
        return { rows, rowCount: rows.length };
      }) as AflOutcomeSqlClient['query'],
      transaction: async (work) => {
        inTransaction = true;
        try {
          return await work(sql);
        } finally {
          inTransaction = false;
        }
      },
    };
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      sql,
      artifactRepository: createAflTradeFixtureArtifactRepository(),
      gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    });
    await expect(
      adapter.consumeIntentOnce({
        authorizationId: `model-run-authorization:${'a'.repeat(64)}`,
        intentId: fixture.intent.intentId,
        consumedAt: fixture.startedAt,
      })
    ).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
      message: 'Native PAV requires the exact admitted consumed-field sets.',
    });
    expect(inTransaction).toBe(false);
  });

  it('requires current canonical provenance when loading a retained native pair', async () => {
    const fixture = await admittedPavModelRunFixture();
    const sql: AflOutcomeSqlClient = {
      query: (async (statement: string) => {
        const rows = statement.includes('SELECT protocol.protocol_json')
          ? [
              {
                protocol_json: fixture.protocol,
                observation_json: fixture.observationSet,
                admission_json: fixture.admission,
                dataset_json: fixture.evidence.datasetCandidate,
                operational_authorization_json: fixture.evidence.operationalAuthorization,
                gate2_decision_key: fixture.evidence.gate2DecisionKey,
              },
            ]
          : [];
        return { rows, rowCount: rows.length };
      }) as AflOutcomeSqlClient['query'],
      transaction: async (work) => work(sql),
    };
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      sql,
      artifactRepository: createAflTradeFixtureArtifactRepository(),
      gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    });
    await expect(adapter.authenticate({ intent: fixture.intent })).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
      message: 'Model-run authority requires current canonical-promotion provenance.',
    });
  });

  it('rejects missing current PAV source evidence before retaining model records', async () => {
    const fixture = await admittedPavModelRunFixture();
    const sql: AflOutcomeSqlClient = {
      query: (async (statement: string) => {
        if (/INSERT|UPDATE/.test(statement))
          throw new Error('Native parents were not authenticated.');
        const rows = statement.includes('SELECT admission.admission_json')
          ? [
              {
                admission_json: fixture.admission,
                dataset_json: fixture.evidence.datasetCandidate,
                analytical_authority_receipt_id: 'fixture-authority',
                gate2_decision_key: fixture.evidence.gate2DecisionKey,
              },
            ]
          : [];
        return { rows, rowCount: rows.length };
      }) as AflOutcomeSqlClient['query'],
      transaction: async (work) => work(sql),
    };
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      sql,
      artifactRepository: createAflTradeFixtureArtifactRepository(),
      gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    });
    await expect(
      adapter.prepare({
        protocol: fixture.protocol,
        observationSet: fixture.observationSet,
        intent: fixture.intent,
        operationalAuthorization: fixture.evidence.operationalAuthorization,
        runStartEvaluationReceipts: fixture.evidence.runStartEvaluationReceipts,
      })
    ).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
      message: 'Native PAV requires the exact admitted consumed-field sets.',
    });
  });

  it('requires a durably finalized admission for a native pair', async () => {
    const fixture = await admittedPavModelRunFixture();
    const sql: AflOutcomeSqlClient = {
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async (work) => work(sql),
    };
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      sql,
      artifactRepository: createAflTradeFixtureArtifactRepository(),
      gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
    });
    await expect(
      adapter.prepare({
        protocol: fixture.protocol,
        observationSet: fixture.observationSet,
        intent: fixture.intent,
        operationalAuthorization: fixture.evidence.operationalAuthorization,
        runStartEvaluationReceipts: fixture.evidence.runStartEvaluationReceipts,
      })
    ).rejects.toMatchObject({
      code: 'MISSING_EVIDENCE',
      message: 'Model-run authority requires one exact finalized dataset admission.',
    });
  });
});
