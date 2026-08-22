import 'server-only';

import { isAbsolute } from 'node:path';

import { DEVELOPMENT_AUTH_USER_ID } from '@/lib/devAuth';
import type { DraftTradeDetail } from '@/lib/draftTrades/read';
import { getExplicitAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import type {
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
} from '../valuation/governedPrivateEvaluationWorkspace';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '../valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import { createLocalAflTradePrivateDerivedArtifactRepository } from './localFileConditionalObjectStore';
import type { LocalPrivateReviewedTradeCalculation } from './localPrivateReviewedTradeCalculation';
import { getLocalOutcomesRuntimePool } from './localOutcomesRuntimePool';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from './localOutcomesRuntimeIdentity';
import {
  localWorkbookEvaluationService,
  type LocalWorkbookEvaluationArchive,
  type LocalWorkbookEvaluationEnvironment,
  type LocalWorkbookEvaluationService,
  type LocalWorkbookTradeEvaluation,
} from './localWorkbookEvaluation';
import { loadPostgresLocalPrivateReviewedTradeCalculation } from './postgresLocalPrivateReviewedTradeCalculation';
import {
  inspectLocalAflTradeValuationReadiness,
  type LocalAflTradeValuationReadiness,
} from './localAflTradeValuationReadiness';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const POSTGRES_WAL_LSN_PATTERN = /^[a-f0-9]+\/[a-f0-9]+$/iu;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const GOVERNED_ARTIFACT_REPOSITORY_ID = 'governed-private-evaluation';
const MAXIMUM_GOVERNED_ARTIFACT_BYTES = 4 * 1024 * 1024;

export interface PrivateLocalWorkbookReadEnvironment extends LocalWorkbookEvaluationEnvironment {
  STATLY_ENABLE_DEV_TOOLS?: string;
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?: string;
  AFL_TRADE_LOCAL_ARTIFACT_ROOT?: string;
}

type ArchiveQuery = Parameters<LocalWorkbookEvaluationService['loadArchive']>[0];
type ArchiveResult = Promise<LocalWorkbookEvaluationArchive | null>;
export interface PrivateLocalWorkbookTradeEvaluation extends LocalWorkbookTradeEvaluation {
  governedEvaluation?: GovernedPrivateEvaluationReadResult;
}
type TradeResult = Promise<PrivateLocalWorkbookTradeEvaluation | null>;

export interface PrivateLocalWorkbookReads {
  loadArchive(query: ArchiveQuery): ArchiveResult;
  loadTrade(tradeId: string): TradeResult;
  loadExactJsonExport(tradeId: string): Promise<GovernedPrivateEvaluationReadResult | null>;
}

export interface PrivateLocalWorkbookReadDependencies {
  authenticate(): Promise<string | null>;
  authenticateRuntime(environment: Readonly<PrivateLocalWorkbookReadEnvironment>): Promise<void>;
  readValuationReadinessGeneration(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>
  ): Promise<string>;
  inspectValuationReadiness(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    scopeKey: string
  ): Promise<LocalAflTradeValuationReadiness>;
  loadPrivateCalculation?(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    detail: DraftTradeDetail,
    workbookSha256: string
  ): Promise<LocalPrivateReviewedTradeCalculation | null>;
  readGovernedEvaluation?(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    principalId: string,
    request: GovernedPrivateEvaluationReadRequest
  ): Promise<GovernedPrivateEvaluationReadResult>;
  environment(): PrivateLocalWorkbookReadEnvironment;
  evaluation: LocalWorkbookEvaluationService;
}

function snapshotEnvironment(
  environment: PrivateLocalWorkbookReadEnvironment
): Readonly<PrivateLocalWorkbookReadEnvironment> {
  return Object.freeze({
    NODE_ENV: environment.NODE_ENV,
    STATLY_ENABLE_DEV_TOOLS: environment.STATLY_ENABLE_DEV_TOOLS,
    AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: environment.AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED,
    AFL_OUTCOMES_DEV_WORKBOOK_PATH: environment.AFL_OUTCOMES_DEV_WORKBOOK_PATH,
    AFL_OUTCOMES_DEV_WORKBOOK_SHA256: environment.AFL_OUTCOMES_DEV_WORKBOOK_SHA256,
    AFL_OUTCOMES_DATABASE_URL: environment.AFL_OUTCOMES_DATABASE_URL,
    AFL_TRADE_LOCAL_ARTIFACT_ROOT: environment.AFL_TRADE_LOCAL_ARTIFACT_ROOT,
    STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE,
  });
}

function isEnabled(environment: Readonly<PrivateLocalWorkbookReadEnvironment>): boolean {
  return (
    environment.NODE_ENV !== 'production' &&
    environment.STATLY_ENABLE_DEV_TOOLS?.trim().toLowerCase() === 'true' &&
    environment.AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED?.trim().toLowerCase() === 'true'
  );
}

function hasValidRuntimeConfiguration(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): boolean {
  const workbookPath = environment.AFL_OUTCOMES_DEV_WORKBOOK_PATH?.trim();
  const workbookSha256 = environment.AFL_OUTCOMES_DEV_WORKBOOK_SHA256?.trim().toLowerCase();
  const runtimeNonce = environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
  if (
    !workbookPath ||
    !isAbsolute(workbookPath) ||
    !workbookSha256 ||
    !SHA256_PATTERN.test(workbookSha256) ||
    !runtimeNonce ||
    !SHA256_PATTERN.test(runtimeNonce)
  ) {
    return false;
  }

  try {
    const database = new URL(environment.AFL_OUTCOMES_DATABASE_URL?.trim() ?? '');
    return (
      (database.protocol === 'postgres:' || database.protocol === 'postgresql:') &&
      LOOPBACK_HOSTS.has(database.hostname) &&
      database.pathname === '/statly_outcomes_test'
    );
  } catch {
    return false;
  }
}

function hasValidGovernedArtifactConfiguration(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): boolean {
  const artifactRoot = environment.AFL_TRADE_LOCAL_ARTIFACT_ROOT?.trim();
  return artifactRoot !== undefined && artifactRoot !== '' && isAbsolute(artifactRoot);
}

export function createPrivateLocalWorkbookReads(
  dependencies: PrivateLocalWorkbookReadDependencies
): PrivateLocalWorkbookReads {
  const readinessByRuntimeAndScope = new Map<
    string,
    Readonly<{
      generation: string;
      readiness: Promise<LocalAflTradeValuationReadiness>;
    }>
  >();
  const calculationByRuntimeAndTrade = new Map<
    string,
    Readonly<{
      generation: string;
      calculation: Promise<LocalPrivateReviewedTradeCalculation | null>;
    }>
  >();
  const governedBatchByRuntimeAndTrade = new Map<string, string>();

  async function admit(): Promise<Readonly<{
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>;
    principalId: string;
  }> | null> {
    const environment = snapshotEnvironment(dependencies.environment());
    if (!isEnabled(environment)) return null;

    const userId = await dependencies.authenticate();
    if (userId !== DEVELOPMENT_AUTH_USER_ID) return null;

    if (!hasValidRuntimeConfiguration(environment)) {
      throw new Error('Private workbook evaluation runtime configuration is invalid.');
    }
    await dependencies.authenticateRuntime(environment);
    return Object.freeze({ environment, principalId: userId });
  }

  function governedRequest(
    evaluation: LocalWorkbookTradeEvaluation,
    document: GovernedPrivateEvaluationReadRequest['document'],
    selection: GovernedPrivateEvaluationReadRequest['selection'] = { kind: 'current' }
  ): GovernedPrivateEvaluationReadRequest {
    return {
      selector: {
        valuationScopeKey: `afl-men:${evaluation.detail.trade.year}-trades`,
        tradeId: evaluation.detail.trade.tradeId,
      },
      selection,
      document,
    };
  }

  function governedBatchCacheKey(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    evaluation: LocalWorkbookTradeEvaluation
  ): string {
    return `${environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE}\0afl-men:${evaluation.detail.trade.year}-trades\0${evaluation.detail.trade.tradeId}`;
  }

  async function inspectCurrentValuationReadiness(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    scopeKey: string
  ): Promise<LocalAflTradeValuationReadiness> {
    const generation = await dependencies.readValuationReadinessGeneration(environment);
    const cacheKey = `${environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE}\0${scopeKey}`;
    const current = readinessByRuntimeAndScope.get(cacheKey);
    if (current?.generation === generation) return current.readiness;

    const readiness = Promise.resolve().then(() =>
      dependencies.inspectValuationReadiness(environment, scopeKey)
    );
    const entry = Object.freeze({ generation, readiness });
    readinessByRuntimeAndScope.set(cacheKey, entry);
    try {
      return await readiness;
    } catch (error) {
      if (readinessByRuntimeAndScope.get(cacheKey) === entry) {
        readinessByRuntimeAndScope.delete(cacheKey);
      }
      throw error;
    }
  }

  async function loadCurrentPrivateCalculation(
    environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
    detail: DraftTradeDetail,
    workbookSha256: string
  ): Promise<LocalPrivateReviewedTradeCalculation | null> {
    if (!dependencies.loadPrivateCalculation) return null;
    const generation = await dependencies.readValuationReadinessGeneration(environment);
    const cacheKey = `${environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE}\0${workbookSha256}\0${detail.trade.tradeId}`;
    const current = calculationByRuntimeAndTrade.get(cacheKey);
    if (current?.generation === generation) return current.calculation;
    const calculation = dependencies.loadPrivateCalculation(environment, detail, workbookSha256);
    const entry = Object.freeze({ generation, calculation });
    calculationByRuntimeAndTrade.set(cacheKey, entry);
    try {
      return await calculation;
    } catch (error) {
      if (calculationByRuntimeAndTrade.get(cacheKey) === entry) {
        calculationByRuntimeAndTrade.delete(cacheKey);
      }
      throw error;
    }
  }

  return {
    async loadArchive(query) {
      const admitted = await admit();
      if (admitted === null) return null;
      const { environment } = admitted;
      return dependencies.evaluation.loadArchive(query, environment, (scopeKey) =>
        inspectCurrentValuationReadiness(environment, scopeKey)
      );
    },

    async loadTrade(tradeId) {
      const admitted = await admit();
      if (admitted === null) return null;
      const { environment, principalId } = admitted;
      const evaluation = await dependencies.evaluation.loadTrade(
        tradeId,
        environment,
        (scopeKey) => inspectCurrentValuationReadiness(environment, scopeKey),
        dependencies.loadPrivateCalculation
          ? (detail, workbookSha256) =>
              loadCurrentPrivateCalculation(environment, detail, workbookSha256)
          : undefined
      );
      if (evaluation === null || dependencies.readGovernedEvaluation === undefined) {
        return evaluation;
      }
      if (!hasValidGovernedArtifactConfiguration(environment)) {
        throw new Error('Governed private evaluation artifact configuration is invalid.');
      }
      const governedEvaluation = await dependencies.readGovernedEvaluation(
        environment,
        principalId,
        governedRequest(evaluation, { kind: 'detail' })
      );
      const batchCacheKey = governedBatchCacheKey(environment, evaluation);
      if (governedEvaluation.state === 'available' && governedEvaluation.batchId !== null) {
        governedBatchByRuntimeAndTrade.set(batchCacheKey, governedEvaluation.batchId);
      } else {
        governedBatchByRuntimeAndTrade.delete(batchCacheKey);
      }
      return { ...evaluation, governedEvaluation };
    },

    async loadExactJsonExport(tradeId) {
      const admitted = await admit();
      if (admitted === null || dependencies.readGovernedEvaluation === undefined) return null;
      const { environment, principalId } = admitted;
      if (!hasValidGovernedArtifactConfiguration(environment)) {
        throw new Error('Governed private evaluation artifact configuration is invalid.');
      }
      const evaluation = await dependencies.evaluation.loadTrade(
        tradeId,
        environment,
        (scopeKey) => inspectCurrentValuationReadiness(environment, scopeKey),
        dependencies.loadPrivateCalculation
          ? (detail, workbookSha256) =>
              loadCurrentPrivateCalculation(environment, detail, workbookSha256)
          : undefined
      );
      if (evaluation === null) return null;
      const batchCacheKey = governedBatchCacheKey(environment, evaluation);
      const batchId = governedBatchByRuntimeAndTrade.get(batchCacheKey);
      const governedEvaluation = await dependencies.readGovernedEvaluation(
        environment,
        principalId,
        governedRequest(
          evaluation,
          { kind: 'json_export' },
          batchId === undefined ? { kind: 'current' } : { kind: 'batch', batchId }
        )
      );
      if (
        batchId === undefined &&
        governedEvaluation.state === 'available' &&
        governedEvaluation.batchId !== null
      ) {
        governedBatchByRuntimeAndTrade.set(batchCacheKey, governedEvaluation.batchId);
      }
      return governedEvaluation;
    },
  };
}

async function authenticateLocalOutcomesRuntime(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): Promise<void> {
  const pool = getLocalOutcomesRuntimePool(environment.AFL_OUTCOMES_DATABASE_URL!);
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    pool,
    environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE!
  );
}

async function inspectAdmittedLocalValuationReadiness(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
  scopeKey: string
): Promise<LocalAflTradeValuationReadiness> {
  const pool = getLocalOutcomesRuntimePool(environment.AFL_OUTCOMES_DATABASE_URL!);
  return inspectLocalAflTradeValuationReadiness(pool, { scopeKey });
}

async function loadAdmittedPrivateCalculation(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
  detail: DraftTradeDetail,
  workbookSha256: string
): Promise<LocalPrivateReviewedTradeCalculation> {
  const pool = getLocalOutcomesRuntimePool(environment.AFL_OUTCOMES_DATABASE_URL!);
  return loadPostgresLocalPrivateReviewedTradeCalculation(createPgAflOutcomeSqlClient(pool), {
    detail,
    workbookSha256,
  });
}

async function readLocalValuationReadinessGeneration(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): Promise<string> {
  const pool = getLocalOutcomesRuntimePool(environment.AFL_OUTCOMES_DATABASE_URL!);
  const result = await pool.query<{ generation: string }>(
    'SELECT pg_current_wal_lsn()::text AS generation'
  );
  const generation = result.rows[0]?.generation?.trim();
  if (!generation || !POSTGRES_WAL_LSN_PATTERN.test(generation)) {
    throw new Error('The outcomes readiness generation is invalid.');
  }
  return generation;
}

async function readAdmittedGovernedEvaluation(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
  principalId: string,
  request: GovernedPrivateEvaluationReadRequest
): Promise<GovernedPrivateEvaluationReadResult> {
  const pool = getLocalOutcomesRuntimePool(environment.AFL_OUTCOMES_DATABASE_URL!);
  if (!hasValidGovernedArtifactConfiguration(environment)) {
    throw new Error('Governed private evaluation artifact configuration is invalid.');
  }
  const artifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: environment.AFL_TRADE_LOCAL_ARTIFACT_ROOT!.trim(),
    repositoryId: GOVERNED_ARTIFACT_REPOSITORY_ID,
    maximumObjectBytes: MAXIMUM_GOVERNED_ARTIFACT_BYTES,
  });
  return createPostgresGovernedPrivateEvaluationWorkspace({
    client: createPgAflOutcomeSqlClient(pool),
    artifactRepository,
    maximumArtifactBytes: MAXIMUM_GOVERNED_ARTIFACT_BYTES,
    principalId,
    authorizeReader: async ({ principalId: candidatePrincipalId }) =>
      candidatePrincipalId === principalId && candidatePrincipalId === DEVELOPMENT_AUTH_USER_ID,
  }).read(request);
}

export const privateLocalWorkbookReads = createPrivateLocalWorkbookReads({
  authenticate: getExplicitAuthenticatedUserIdFromServerContext,
  authenticateRuntime: authenticateLocalOutcomesRuntime,
  readValuationReadinessGeneration: readLocalValuationReadinessGeneration,
  inspectValuationReadiness: inspectAdmittedLocalValuationReadiness,
  loadPrivateCalculation: loadAdmittedPrivateCalculation,
  readGovernedEvaluation: readAdmittedGovernedEvaluation,
  environment: () => process.env,
  evaluation: localWorkbookEvaluationService,
});
