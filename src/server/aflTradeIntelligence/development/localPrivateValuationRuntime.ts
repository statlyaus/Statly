import { resolve } from 'node:path';

import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient, type AflOutcomePgPool } from '../outcomes/pgOutcomeSqlClient';
import { stageAflTradeFitzRoySourceSnapshot } from '../source/fitzRoyCaptureToStaging';
import { captureAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import { createAflTradeCurrentValuationEvidenceCoordinator } from '../valuation/currentValuationEvidenceOrchestration';
import { createAflTradeCurrentValuationRefresh } from '../valuation/currentValuationRefresh';
import { createAflTradePrivateRecalculationCoordinator } from '../valuation/privateRecalculationCoordinator';
import { composePostgresAflTradeCurrentValuationModelEvidenceDispatch } from '../valuation/postgresCurrentValuationModelEvidencePreparation';
import { createPostgresAflTradePrivateCurrentValuationCohortCoordinator } from '../valuation/postgresCurrentValuationCohortPreparation';
import { aflTradeCurrentPrivateFactualAuthoritySchema } from '../valuation/currentValuationModelEvidence';
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
import type { LocalPrivateValuationConstructionBlocker } from './localPrivateValuationConstructionReport';
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

type AflTradeLocalPrivateValuationCohortDependencies = Omit<
  Parameters<typeof createPostgresAflTradePrivateCurrentValuationCohortCoordinator>[0],
  'client' | 'artifactRepository' | 'maximumArtifactBytes'
>;

export interface AflTradeLocalPrivateValuationConstruction {
  readonly modelPair: Parameters<
    typeof composePostgresAflTradeCurrentValuationModelEvidenceDispatch
  >[0]['modelPair'];
  /**
   * Either fixed cohort dependencies, or a builder the runtime calls with the live claimed dispatch.
   * Construction evidence authenticates exactly one dispatch identity, which only exists per
   * dispatch, so a dispatch-bound cohort half is the only honest way to compose it.
   */
  readonly cohort:
    | AflTradeLocalPrivateValuationCohortDependencies
    | ((input: {
        readonly requestId: string;
        readonly claim: { readonly claimId: string; readonly leaseToken: string };
      }) => AflTradeLocalPrivateValuationCohortDependencies);
}

export class AflTradeLocalPrivateValuationConfigurationError extends Error {
  readonly code = 'MISSING_CONSTRUCTION_CONFIGURATION';
  /** Every named authority the composition root reported as missing, in stable code order. */
  readonly blockerCodes: readonly string[];
  readonly blockers: readonly LocalPrivateValuationConstructionBlocker[];

  constructor(blockers: readonly LocalPrivateValuationConstructionBlocker[] = []) {
    const blockerCodes = [...new Set(blockers.map((blocker) => blocker.code))].sort((left, right) =>
      left.localeCompare(right)
    );
    super(
      'Changed factual evidence requires exact admitted model and cohort construction configuration; ' +
        `local batch execution is blocked${
          blockerCodes.length === 0 ? '' : ` by ${blockerCodes.join(', ')}`
        }.`
    );
    this.name = 'AflTradeLocalPrivateValuationConfigurationError';
    this.blockerCodes = blockerCodes;
    this.blockers = blockers;
  }
}

export function createLocalAflTradePrivateValuationRuntime(input: {
  readonly pool: AflOutcomePgPool;
  readonly artifactRoot: string;
  readonly workerId?: string;
  readonly construction?: AflTradeLocalPrivateValuationConstruction;
  /** Why `construction` is absent, so the configuration failure names each missing authority. */
  readonly constructionBlockers?: readonly LocalPrivateValuationConstructionBlocker[];
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
    enableAutomatedPrivateCalculation: true,
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
  const construction = input.construction;
  const constructionBlockers = input.constructionBlockers ?? [];
  const buildPrepared =
    construction === undefined
      ? null
      : (requestId: string, claim: { readonly claimId: string; readonly leaseToken: string }) =>
          createPostgresAflTradePrivateCurrentValuationCohortCoordinator({
            ...(typeof construction.cohort === 'function'
              ? construction.cohort({ requestId, claim })
              : construction.cohort),
            client,
            artifactRepository: artifacts,
            maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
          });
  const coordinator = createAflTradePrivateRecalculationCoordinator({
    evidence: {
      refreshCurrent: async (request) => {
        const result = await evidence.refreshCurrent(request);
        if (
          result.state === 'unavailable' ||
          result.currentValuationRefresh.state === 'unavailable'
        ) {
          return { state: 'unavailable' as const };
        }
        return {
          state: 'complete' as const,
          currentValuationRefresh: result.currentValuationRefresh,
        };
      },
    },
    modelEvidence: {
      refresh: async ({ dispatch, factual }) => {
        if (construction === undefined)
          throw new AflTradeLocalPrivateValuationConfigurationError(constructionBlockers);
        return composePostgresAflTradeCurrentValuationModelEvidenceDispatch({
          client,
          dispatch,
          modelPair: construction.modelPair,
        }).refresh({
          scopeKey: factual.scopeKey,
          factualOperationId: factual.operationId,
          privateFactualAuthority: aflTradeCurrentPrivateFactualAuthoritySchema.parse(
            factual.privateFactualAuthority
          ),
        });
      },
    },
    prepared: {
      prepare: async ({ request, claim }) => {
        if (buildPrepared === null)
          throw new AflTradeLocalPrivateValuationConfigurationError(constructionBlockers);
        return buildPrepared(request.requestId, claim).prepare({
          requestId: request.requestId,
          claim,
        });
      },
    },
    batch: runner,
  });
  return createPostgresAflTradePrivateValuationDispatcher({
    repository: new PostgresAflTradePrivateValuationScheduleRepository(client),
    runner: {
      run: (dispatch) => coordinator.run(dispatch),
      repairCurrent: (scopeKey, reason, repairOperationId) =>
        runner.repairPrivateCurrent(scopeKey, reason, repairOperationId),
    },
    workerId: input.workerId,
  });
}
