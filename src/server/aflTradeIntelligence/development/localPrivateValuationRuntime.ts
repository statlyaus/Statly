import { resolve } from 'node:path';

import type { Pool } from 'pg';

import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { stageAflTradeFitzRoySourceSnapshot } from '../source/fitzRoyCaptureToStaging';
import { captureAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import { createAflTradeCurrentValuationEvidenceCoordinator } from '../valuation/currentValuationEvidenceOrchestration';
import { createAflTradeCurrentValuationRefresh } from '../valuation/currentValuationRefresh';
import { createAflTradePrivateValuationDispatchEvidenceKey } from '../valuation/privateValuationScheduling';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '../valuation/postgresCurrentValuationCohortRunner';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '../valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '../valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import {
  PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository,
  createPostgresAflTradeCurrentValuationEvidenceSourceRuntime,
  retainAflTradeCurrentValuationObservedCapture,
} from '../valuation/postgresCurrentValuationEvidenceOrchestration';
import {
  PostgresAflTradePrivateValuationScheduleRepository,
  createPostgresAflTradePrivateValuationDispatcher,
} from '../valuation/postgresPrivateValuationScheduling';
import {
  AflTradePrivateReviewedEvidenceEvaluationPersistenceError,
  PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority,
} from '../valuation/postgresPrivateReviewedEvidenceEvaluationAuthority';
import { createLocalAflTradeCurrentValuationReconciliationAuthority } from './localCurrentValuationReconciliationAuthority';
import { createLocalAflTradeDockerFitzRoyCaptureExecutor } from './localDockerFitzRoyCaptureExecutor';
import { createLocalAflTradeDockerFitzRoyDecodeExecutor } from './localDockerFitzRoyDecodeExecutor';
import { createLocalAflTradeEgressSigningAuthority } from './localEgressSigningAuthority';
import {
  createLocalAflTradeNonProductionArtifactRepository,
  createLocalAflTradePrivateDerivedArtifactRepository,
} from './localFileConditionalObjectStore';
import { LOCAL_AFL_TRADE_FITZROY_RUNTIME } from './localFiveSeasonAflTablesStaging';

const MAXIMUM_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_SOURCE_BYTES = 128 * 1024 * 1024;
const MAXIMUM_METADATA_BYTES = 16 * 1024 * 1024;

function now(): string {
  return new Date().toISOString();
}

export function createLocalAflTradePrivateValuationRuntime(input: {
  readonly pool: Pool;
  readonly artifactRoot: string;
  readonly workerId?: string;
}): ReturnType<typeof createPostgresAflTradePrivateValuationDispatcher> {
  const client = createPgAflOutcomeSqlClient(input.pool);
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);
  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: resolve(input.artifactRoot, 'current-valuation-evidence'),
    repositoryId: 'current-valuation-evidence-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: MAXIMUM_SOURCE_BYTES,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: resolve(input.artifactRoot, 'current-valuation-evidence'),
    repositoryId: 'current-valuation-evidence-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: MAXIMUM_METADATA_BYTES,
  });
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const egressSigningAuthority = createLocalAflTradeEgressSigningAuthority({
    artifactRoot: input.artifactRoot,
  });
  const egressExecutionVerifier = egressSigningAuthority.verifier;
  const decoderExecutor = createLocalAflTradeDockerFitzRoyDecodeExecutor({
    imageReference: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
  });
  const ensureReferenceData = async () => {
    await client.query(
      `INSERT INTO outcome_competition_season (competition,season_year)
       SELECT 'AFLM',season_year FROM unnest($1::smallint[]) seasons(season_year)
       ON CONFLICT DO NOTHING`,
      [[2021, 2022, 2023, 2024, 2025, 2026]]
    );
    await client.query(
      `INSERT INTO outcome_metric_definition
        (metric_code,definition_version,display_name,value_type,canonical_unit,
         non_negative,definition_json,status)
       VALUES
        ('goals','goals/v1','Goals','numeric','goals',true,'{}'::jsonb,'approved'),
        ('games','games/v1','Games','numeric','games',true,'{}'::jsonb,'approved'),
        ('brownlow_votes','brownlow-votes/v1','Brownlow votes','numeric','votes',true,'{}'::jsonb,'approved'),
        ('coaches_votes','coaches-votes/v1','Coaches votes','numeric','votes',true,'{}'::jsonb,'approved')
       ON CONFLICT DO NOTHING`
    );
  };
  const stagingDependencies = {
    rawArtifactRepository,
    sourceCaptureRepository,
    providerObservationRepository,
    decoderExecutor,
    clock: { now },
    dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
    imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
    timeoutMs: 180_000,
    maximumSourceBytes: MAXIMUM_SOURCE_BYTES,
    maximumRows: 20_000,
    maximumFields: 120,
    maximumCells: 2_000_000,
    maximumCellBytes: 8_192,
    maximumOutputBytes: 256 * 1024 * 1024,
    egressExecutionVerifier,
  } as const;
  const evidenceSource = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
    client,
    gateRepository,
    clock: { now },
    normalizationRuntime: {
      dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
    },
    capture: async ({ source, authority, request, authoritySha256 }) => {
      await ensureReferenceData();
      const rate = authority.capture.sourceRights.content.automatedAccess.rateLimit;
      const egressPolicyEvidenceId = authority.capture.sourceRights.content.conditions.find(
        ({ conditionId }) => conditionId === 'provider-egress-control'
      )?.verificationEvidenceIds[0];
      if (rate === null || egressPolicyEvidenceId === undefined) {
        throw new TypeError('Current valuation capture lacks exact egress authority.');
      }
      const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(
        {
          capture: authority.capture,
          fieldMapId: authority.fieldMap.mapId,
          fieldMap: authority.fieldMap,
          effectiveAt: now(),
        },
        {
          capture: {
            rawArtifactRepository,
            metadataArtifactRepository,
            executor: createLocalAflTradeDockerFitzRoyCaptureExecutor({
              imageReference: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
              runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
              admittedPolicy: {
                upstreamRate: rate,
                cacheSeconds: authority.capture.gateRequest.cacheSeconds ?? 0,
                egressPolicyEvidenceId,
              },
              signingKey: egressSigningAuthority.signingKey,
            }),
            egressExecutionVerifier,
            authorizationResolver: gateRepository,
            clock: { now },
            runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
            timeoutMs: 180_000,
            maximumSourceBytes: MAXIMUM_SOURCE_BYTES,
            maximumDiagnosticsBytes: 4 * 1024 * 1024,
          },
          staging: stagingDependencies,
          clock: { now },
        }
      );
      const persisted = await sourceCaptureRepository.persist(captured.snapshot, {
        afterPersist: async ({ transaction, capture, sourceContentSha256 }) => {
          await retainAflTradeCurrentValuationObservedCapture(transaction, {
            request,
            source,
            observedCaptureId: capture.captureId,
            sourceContentSha256,
            authoritySha256,
          });
        },
      });
      return {
        captureId: persisted.captureId,
        sourceContentSha256: captured.snapshot.content.sourceArtifact.contentSha256,
        snapshot: captured.snapshot,
      };
    },
    resumeNormalization: async ({ source, authority, snapshot }) => {
      await ensureReferenceData();
      const staging = await stageAflTradeFitzRoySourceSnapshot(
        {
          snapshot,
          fieldMapId: authority.fieldMap.mapId,
          fieldMap: authority.fieldMap,
        },
        stagingDependencies
      );
      return {
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: staging.capture.captureId,
        effectiveCaptureId: staging.capture.captureId,
        normalizationRunId: staging.normalization.normalizationRunId,
      };
    },
  });
  const reviewedAuthority = new PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority(client);
  const evidence = createAflTradeCurrentValuationEvidenceCoordinator({
    repository: new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client),
    source: evidenceSource,
    reconciliationAuthority: createLocalAflTradeCurrentValuationReconciliationAuthority(client),
    reviewedAuthority: {
      assessCurrent: async ({ valuationScopeKey, stableOperationKey }) => {
        try {
          const assessment = await reviewedAuthority.assessCurrent({
            valuationScopeKey,
            stableOperationKey,
          });
          if (assessment.state === 'authorized') return { state: 'ready' as const };
          return assessment.state === 'withdrawn'
            ? {
                state: 'unavailable' as const,
                stage: 'reviewed_authority' as const,
                cause: 'unauthenticated' as const,
              }
            : {
                state: 'unavailable' as const,
                stage: 'reviewed_authority' as const,
                cause: 'review_required' as const,
              };
        } catch (error) {
          const cause =
            error instanceof AflTradePrivateReviewedEvidenceEvaluationPersistenceError
              ? error.code === 'EVIDENCE_MISMATCH'
                ? ('stale' as const)
                : error.code === 'IMMUTABLE_CONFLICT'
                  ? ('unauthenticated' as const)
                  : ('mismatched' as const)
              : ('mismatched' as const);
          return {
            state: 'unavailable' as const,
            stage: 'reviewed_authority' as const,
            cause,
          };
        }
      },
    },
    factualRefresh: createAflTradeCurrentValuationRefresh({ client }),
  });
  const artifacts = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: input.artifactRoot,
    repositoryId: 'governed-private-evaluation',
    maximumObjectBytes: MAXIMUM_ARTIFACT_BYTES,
  });
  const workspace = createPostgresGovernedPrivateEvaluationWorkspace({
    client,
    artifactRepository: artifacts,
    maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
    principalId: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    authorizeReader: async () => false,
  });
  const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
    client,
    workspace,
    batchRepository: new PostgresGovernedPrivateEvaluationBatchRepository(
      client,
      async () => false
    ),
    workerId: input.workerId,
  });
  return createPostgresAflTradePrivateValuationDispatcher({
    repository: new PostgresAflTradePrivateValuationScheduleRepository(client),
    runner: {
      run: async ({ request }) => {
        const result = await evidence.refreshCurrent({
          scopeKey: request.scopeKey,
          trigger: request.trigger,
          stableOperationKey: createAflTradePrivateValuationDispatchEvidenceKey(request),
        });
        if (result.state === 'unavailable') return { state: 'exhausted' as const };
        return runner.runCurrent(request.scopeKey);
      },
      repairCurrent: (scopeKey, reason, repairOperationId) =>
        runner.repairCurrent(scopeKey, reason, repairOperationId),
    },
    workerId: input.workerId,
  });
}
