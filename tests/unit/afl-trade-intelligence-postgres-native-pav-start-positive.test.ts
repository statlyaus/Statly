import { describe, expect, it } from 'vitest';
import { aflTradeModelRunCheckpointSchema } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

// Synthetic database boundary: adapter composition, not SQL atomicity or genuine authority.
describe('native PAV started checkpoint adapter composition', () => {
  it.each(['exact_readback', 'missing_readback'] as const)(
    'composes native start with %s in the consumption transaction',
    async (readback) => {
      const fixture = await nativePavModelRunSqlFixture(readback);
      const {
        sql,
        artifactRepository,
        protocol,
        observationSet,
        intent,
        authorization,
        operationalAuthorization,
        runStartEvaluationReceipts,
        startedAt,
        calls,
      } = fixture;
      const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
        sql,
        artifactRepository,
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
      });
      await adapter.prepare({
        protocol,
        observationSet,
        intent,
        operationalAuthorization,
        runStartEvaluationReceipts,
      });
      expect(await adapter.issueOnceForIntent({ authorization, intent })).toBe(true);
      const consume = () =>
        adapter.consumeIntentOnce({
          authorizationId: authorization.authorizationId,
          intentId: intent.intentId,
          consumedAt: startedAt,
        });
      if (readback === 'missing_readback') {
        await expect(consume()).rejects.toMatchObject({
          code: 'MISSING_EVIDENCE',
          message: 'Model-run authority requires one exact model-run checkpoint.',
        });
        return;
      }
      expect(await consume()).toBe(true);
      expect(aflTradeModelRunCheckpointSchema.parse(fixture.checkpoint).content).toMatchObject({
        stage: 'started',
        intentId: intent.intentId,
        rootIntentId: intent.intentId,
        authorizationId: authorization.authorizationId,
        candidateArtifact: null,
        evidenceArtifact: null,
        previousCheckpointId: null,
      });
      const consumeCalls = calls.filter((call) => call.transaction === 3).map((call) => call.sql);
      expect(
        consumeCalls.some((statement) =>
          statement.includes('FROM outcome_hpn_pav_input_set input_set')
        )
      ).toBe(true);
      expect(
        consumeCalls.some((statement) =>
          statement.includes('INSERT INTO outcome_valuation_model_run_checkpoint')
        )
      ).toBe(true);
      expect(
        consumeCalls.some((statement) =>
          statement.includes('SELECT checkpoint_json AS document_json')
        )
      ).toBe(true);
      expect(await consume()).toBe(false);
    },
    60_000
  );
});
