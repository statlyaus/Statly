import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAflTradeModelRunContinuationIntent,
  type AflTradeModelRunIntent,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { aflTradeAnyModelRunCheckpointSchema } from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AflTradeAdmittedModelRunAuthorityService,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { aflTradeAdmittedPlayerPavCandidateSchema } from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

// Synthetic SQL boundary; real retained document constructors and current-source owners.
// This proves application composition, not database claim or transaction enforcement.
describe('native PAV continuation PostgreSQL adapter', () => {
  it('loads the exact retained continuation ancestry with current child evidence', async () => {
    const fixture = await nativePavModelRunSqlFixture();
    const rootDirectory = await mkdtemp(join(tmpdir(), 'statly-native-continuation-'));
    try {
      const repository = createLocalAflTradePrivateDerivedArtifactRepository({
        rootDirectory,
        repositoryId: 'native-continuation',
        maximumObjectBytes: 4 * 1024 * 1024,
      });
      const base = new PostgresAflTradeAdmittedModelRunAuthority({
        sql: fixture.sql,
        artifactRepository: fixture.artifactRepository,
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(
          fixture.sql
        ),
        candidateArtifactRepository: {
          ...repository,
          async putIfAbsent(reference, bytes) {
            if (
              JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion ===
              'afl-trade-native-pav-validation-plan-evidence/v1'
            )
              throw new Error('Synthetic root plan storage interruption');
            return repository.putIfAbsent(reference, bytes);
          },
        },
      });
      await base.prepare(fixture);
      expect(await base.issueOnceForIntent(fixture)).toBe(true);
      expect(
        await base.consumeIntentOnce({
          intentId: fixture.intent.intentId,
          authorizationId: fixture.authorization.authorizationId,
          consumedAt: fixture.startedAt,
        })
      ).toBe(true);
      await expect(
        base.retainNativeCandidateCheckpoint({
          intentId: fixture.intent.intentId,
          authorizationId: fixture.authorization.authorizationId,
        })
      ).rejects.toThrow('Synthetic root plan storage interruption');
      const checkpoint = aflTradeAnyModelRunCheckpointSchema.parse(fixture.checkpoint);
      expect(checkpoint.content.stage).toBe('pre_final_retained');
      const childStartedAt = new Date(Date.parse(fixture.startedAt) + 40_000).toISOString();
      const freshReceipts = fixture.evidence.runStartEvaluationReceipts.map((receipt) =>
        createAflTradeGate0AReceipt(
          fixture.evidence.gateDecisionLedger,
          fixture.evidence.sourceRightsProposals.find(
            (proposal) => proposal.rightsArtifactId === receipt.content.request.rightsArtifactId
          )!,
          { ...receipt.content.request, evaluatedAt: childStartedAt },
          childStartedAt
        )
      );
      const intent = createAflTradeModelRunContinuationIntent({
        previousIntent: fixture.intent,
        checkpoint,
        startedAt: childStartedAt,
        dispatchClaimId: createAflTradeContentAddress('private-valuation-dispatch-claim', {
          synthetic: 'adapter child',
        }),
        dispatchLeaseTokenSha256: 'b'.repeat(64),
        dispatchAttemptNumber: 2,
        modelTrainingEvaluationReceiptIds: freshReceipts.map((receipt) => receipt.receiptId).sort(),
      });
      if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
        throw new Error('Expected child.');
      const original = fixture.operationalAuthorization.content;
      if (
        original.authorityBoundary !==
        'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
      )
        throw new Error('Expected private fixture.');
      let receipt = createAflTradePrivateValuationModelRunOperationalAuthorization({
        ...original,
        runIntentId: intent.intentId,
        dispatchClaimId: intent.content.continuation.dispatchClaimId,
        dispatchLeaseTokenSha256: intent.content.continuation.dispatchLeaseTokenSha256,
        dispatchAttemptNumber: 2,
        authorizedAt: intent.content.startedAt,
        validThrough: new Date(Date.parse(intent.content.startedAt) + 60_000).toISOString(),
      });
      let retainedCheckpoint = true;
      let transactionActive = false;
      let childAuthorization: typeof fixture.authorization | null = null;
      let childConsumed = false;
      let childConsumptions = 0;
      const intents: AflTradeModelRunIntent[] = [fixture.intent, intent];
      const sql: AflOutcomeSqlClient = {
        async query<Row>(statement: string, parameters: readonly unknown[] = []) {
          if (
            statement.includes('FROM outcome_valuation_dataset_gate0_evaluation') &&
            statement.includes('ANY')
          ) {
            const ids = parameters[0] as readonly string[];
            const receipts = [...fixture.evidence.admissionEvaluationReceipts, ...freshReceipts];
            const unique = new Map(receipts.map((receipt) => [receipt.receiptId, receipt]));
            const rows = [...unique.values()]
              .filter((receipt) => ids.includes(receipt.receiptId))
              .map((receipt) => ({ document_json: receipt }));
            return { rows: rows as Row[], rowCount: rows.length };
          }
          if (statement.includes('clock_timestamp()) AS now'))
            return {
              rows: [
                { now: new Date(Date.parse(intent.content.startedAt) + 5_000).toISOString() },
              ] as Row[],
              rowCount: 1,
            };
          if (statement.includes('UPDATE outcome_valuation_model_run_authorization')) {
            expect(parameters.slice(0, 2)).toEqual([
              childAuthorization?.authorizationId,
              intent.intentId,
            ]);
            const rows = childConsumed
              ? []
              : [{ authorization_id: childAuthorization?.authorizationId }];
            if (!childConsumed) childConsumptions += 1;
            childConsumed = true;
            return { rows: rows as Row[], rowCount: rows.length };
          }
          if (statement.includes('SELECT intent.intent_json,operational.receipt_json'))
            return { rows: [] as Row[], rowCount: 0 };
          if (statement.includes('SELECT intent.intent_json,authority.authorization_json'))
            return {
              rows: [
                {
                  intent_json: intent,
                  authorization_json: childAuthorization,
                  consumed_at: childConsumed ? intent.content.startedAt : null,
                  receipt_json: receipt,
                  protocol_json: fixture.protocol,
                  observation_json: fixture.observationSet,
                  dataset_json: fixture.graph.dataset,
                },
              ] as Row[],
              rowCount: 1,
            };
          if (statement.includes('SELECT root.intent_json,authority.consumed_at'))
            return {
              rows: [{ intent_json: fixture.intent, consumed_at: fixture.startedAt }] as Row[],
              rowCount: 1,
            };
          if (
            statement.includes(
              'SELECT intent_json FROM outcome_valuation_model_run_intent WHERE intent_id=$1'
            )
          )
            return {
              rows: intents
                .filter((item) => item.intentId === parameters[0])
                .map((intent_json) => ({ intent_json })) as Row[],
              rowCount: 1,
            };
          if (statement.includes('SELECT intent_json FROM outcome_valuation_model_run_intent'))
            return {
              rows: intents.map((intent_json) => ({ intent_json })) as Row[],
              rowCount: intents.length,
            };
          if (statement.includes('SELECT checkpoint_json') && !retainedCheckpoint)
            return { rows: [] as Row[], rowCount: 0 };
          if (statement.includes('SELECT run.run_json,authority.authorization_json'))
            return { rows: [] as Row[], rowCount: 0 };
          if (statement.includes('SELECT protocol.protocol_json,observation.observation_json')) {
            const result = await fixture.sql.query<Record<string, unknown>>(statement, parameters);
            return {
              rows: result.rows.map((row) => ({
                ...row,
                operational_authorization_json: receipt,
              })) as Row[],
              rowCount: result.rowCount,
            };
          }
          return fixture.sql.query<Row>(statement, parameters);
        },
        async transaction(work) {
          if (transactionActive) return work(sql);
          return fixture.sql.transaction(async () => {
            transactionActive = true;
            try {
              return await work(sql);
            } finally {
              transactionActive = false;
            }
          });
        },
      };
      const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
        sql,
        artifactRepository: {
          async loadExact(reference, maximumBytes) {
            return (
              (await repository.loadExact(reference, maximumBytes)) ??
              fixture.artifactRepository.loadExact(reference, maximumBytes)
            );
          },
        },
        gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
        candidateArtifactRepository: {
          ...repository,
          async putIfAbsent(reference, bytes) {
            if (
              [
                'afl-trade-admitted-player-pav-candidate/v1',
                'afl-trade-native-pav-pre-final-evaluation/v1',
              ].includes(JSON.parse(new TextDecoder().decode(bytes)).content?.schemaVersion)
            )
              throw new Error(
                'Child must restore accepted root numerical stages without rewriting them'
              );
            return repository.putIfAbsent(reference, bytes);
          },
        },
      });
      const evidence = await adapter.authenticate({ intent });
      expect(evidence).toMatchObject({
        operationalAuthorization: receipt,
        continuationAuthority: {
          rootIntent: fixture.intent,
          previousIntent: fixture.intent,
          checkpoint,
        },
      });
      retainedCheckpoint = false;
      await expect(adapter.authenticate({ intent })).rejects.toThrow('ancestry');
      retainedCheckpoint = true;
      const service = new AflTradeAdmittedModelRunAuthorityService({
        authenticator: adapter,
        authorizationStore: adapter,
        clock: { now: async () => intent.content.startedAt },
      });
      const authorized = await service.authorize({ intent, protocol: fixture.protocol });
      expect(authorized, JSON.stringify(authorized)).toMatchObject({ status: 'authorized' });
      if (authorized.status !== 'authorized') throw new Error('Expected current child authority.');
      childAuthorization = authorized.authorization;
      expect(
        await adapter.consumeIntentOnce({
          intentId: intent.intentId,
          authorizationId: childAuthorization.authorizationId,
          consumedAt: intent.content.startedAt,
        })
      ).toBe(true);
      const locked = await adapter.retainNativeCandidateCheckpoint({
        intentId: intent.intentId,
        authorizationId: childAuthorization.authorizationId,
      });
      expect(locked.checkpoint.content).toMatchObject({
        stage: 'candidate_locked',
        intentId: intent.intentId,
        rootIntentId: fixture.intent.intentId,
        authorizationId: childAuthorization.authorizationId,
        dispatchAttemptNumber: 2,
      });
      const artifact = locked.checkpoint.content.candidateArtifact!;
      const loaded = await repository.loadExact(artifact, 4 * 1024 * 1024);
      const candidate = aflTradeAdmittedPlayerPavCandidateSchema.parse(
        JSON.parse(new TextDecoder().decode(loaded!.bytes))
      );
      expect(candidate.content.intentId).toBe(fixture.intent.intentId);
      expect(childConsumptions).toBe(1);
      const finished = await adapter.executeNativeFinalTest({
        intentId: intent.intentId,
        authorizationId: childAuthorization.authorizationId,
      });
      expect(finished.state).toBe('completed');
      if (finished.state !== 'completed') throw new Error('Expected actual child completion.');
      const completed = finished.checkpoint;
      const finalStart = finished.recovery.finalTestCompletionEvidence!.finalTestStartedCheckpoint;
      expect(finalStart.content).toMatchObject({
        intentId: intent.intentId,
        rootIntentId: fixture.intent.intentId,
        dispatchClaimId: intent.content.continuation.dispatchClaimId,
        dispatchAttemptNumber: 2,
        previousCheckpointId: locked.checkpoint.checkpointId,
      });
      expect(
        await adapter.executeNativeFinalTest({
          intentId: intent.intentId,
          authorizationId: childAuthorization.authorizationId,
        })
      ).toEqual(finished);
      expect(childConsumptions).toBe(1);
      const persistenceStartedAt = new Date(Date.parse(childStartedAt) + 10_000).toISOString();
      const persistenceReceipts = fixture.evidence.runStartEvaluationReceipts.map((old) =>
        createAflTradeGate0AReceipt(
          fixture.evidence.gateDecisionLedger,
          fixture.evidence.sourceRightsProposals.find(
            (proposal) => proposal.rightsArtifactId === old.content.request.rightsArtifactId
          )!,
          { ...old.content.request, evaluatedAt: persistenceStartedAt },
          persistenceStartedAt
        )
      );
      freshReceipts.push(...persistenceReceipts);
      const persistenceIntent = createAflTradeModelRunContinuationIntent({
        previousIntent: intent,
        checkpoint: completed,
        startedAt: persistenceStartedAt,
        dispatchClaimId: intent.content.continuation.dispatchClaimId,
        dispatchLeaseTokenSha256: intent.content.continuation.dispatchLeaseTokenSha256,
        dispatchAttemptNumber: 2,
        modelTrainingEvaluationReceiptIds: persistenceReceipts.map((item) => item.receiptId).sort(),
      });
      intents.push(persistenceIntent);
      if (
        receipt.content.authorityBoundary !==
        'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
      )
        throw new Error('Expected private continuation receipt.');
      receipt = createAflTradePrivateValuationModelRunOperationalAuthorization({
        ...receipt.content,
        runIntentId: persistenceIntent.intentId,
        authorizedAt: persistenceStartedAt,
        validThrough: new Date(Date.parse(persistenceStartedAt) + 60_000).toISOString(),
      });
      await expect(adapter.authenticate({ intent: persistenceIntent })).rejects.toThrow(
        'numerical ancestry'
      );
      const persistenceRequest = {
        intent: persistenceIntent,
        purpose: 'persistence_only' as const,
      };
      expect(await adapter.authenticate(persistenceRequest)).toMatchObject({
        operationalAuthorization: receipt,
        continuationAuthority: {
          rootIntent: fixture.intent,
          previousIntent: intent,
          checkpoint: completed,
        },
      });
      const persistenceService = new AflTradeAdmittedModelRunAuthorityService({
        authenticator: adapter,
        authorizationStore: adapter,
        clock: { now: async () => persistenceStartedAt },
      });
      const persistenceAuthority = await persistenceService.authorizePersistenceRecovery({
        intent: persistenceIntent,
        protocol: fixture.protocol,
      });
      expect(persistenceAuthority, JSON.stringify(persistenceAuthority)).toMatchObject({
        status: 'authorized_for_persistence_only',
        intent: persistenceIntent,
      });
      expect(persistenceAuthority).not.toHaveProperty('observationSet');
      expect(persistenceAuthority).not.toHaveProperty('pavObservationSet');
      expect(childConsumptions).toBe(1);
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
