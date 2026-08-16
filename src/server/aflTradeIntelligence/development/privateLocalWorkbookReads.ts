import 'server-only';

import { isAbsolute } from 'node:path';

import { Pool } from 'pg';

import { DEVELOPMENT_AUTH_USER_ID } from '@/lib/devAuth';
import { getExplicitAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from './localOutcomesRuntimeIdentity';
import {
  localWorkbookEvaluationService,
  type LocalWorkbookEvaluationArchive,
  type LocalWorkbookEvaluationEnvironment,
  type LocalWorkbookEvaluationService,
  type LocalWorkbookTradeEvaluation,
} from './localWorkbookEvaluation';
import {
  inspectLocalAflTradeValuationReadiness,
  type LocalAflTradeValuationReadiness,
} from './localAflTradeValuationReadiness';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const POSTGRES_WAL_LSN_PATTERN = /^[a-f0-9]+\/[a-f0-9]+$/iu;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface PrivateLocalWorkbookReadEnvironment extends LocalWorkbookEvaluationEnvironment {
  STATLY_ENABLE_DEV_TOOLS?: string;
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?: string;
}

type ArchiveQuery = Parameters<LocalWorkbookEvaluationService['loadArchive']>[0];
type ArchiveResult = Promise<LocalWorkbookEvaluationArchive | null>;
type TradeResult = Promise<LocalWorkbookTradeEvaluation | null>;

export interface PrivateLocalWorkbookReads {
  loadArchive(query: ArchiveQuery): ArchiveResult;
  loadTrade(tradeId: string): TradeResult;
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

  async function admit(): Promise<Readonly<PrivateLocalWorkbookReadEnvironment> | null> {
    const environment = snapshotEnvironment(dependencies.environment());
    if (!isEnabled(environment)) return null;

    const userId = await dependencies.authenticate();
    if (userId !== DEVELOPMENT_AUTH_USER_ID) return null;

    if (!hasValidRuntimeConfiguration(environment)) {
      throw new Error('Private workbook evaluation runtime configuration is invalid.');
    }
    await dependencies.authenticateRuntime(environment);
    return environment;
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

  return {
    async loadArchive(query) {
      const environment = await admit();
      if (environment === null) return null;
      return dependencies.evaluation.loadArchive(
        query,
        environment,
        (scopeKey) => inspectCurrentValuationReadiness(environment, scopeKey)
      );
    },

    async loadTrade(tradeId) {
      const environment = await admit();
      if (environment === null) return null;
      return dependencies.evaluation.loadTrade(
        tradeId,
        environment,
        (scopeKey) => inspectCurrentValuationReadiness(environment, scopeKey)
      );
    },
  };
}

async function authenticateLocalOutcomesRuntime(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): Promise<void> {
  const pool = new Pool({
    connectionString: environment.AFL_OUTCOMES_DATABASE_URL,
    application_name: 'statly-private-workbook-admission',
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(
      pool,
      environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE!
    );
  } finally {
    await pool.end();
  }
}

async function inspectAdmittedLocalValuationReadiness(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>,
  scopeKey: string
): Promise<LocalAflTradeValuationReadiness> {
  const pool = new Pool({
    connectionString: environment.AFL_OUTCOMES_DATABASE_URL,
    application_name: 'statly-private-workbook-valuation-readiness',
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    return await inspectLocalAflTradeValuationReadiness(pool, { scopeKey });
  } finally {
    await pool.end();
  }
}

async function readLocalValuationReadinessGeneration(
  environment: Readonly<PrivateLocalWorkbookReadEnvironment>
): Promise<string> {
  const pool = new Pool({
    connectionString: environment.AFL_OUTCOMES_DATABASE_URL,
    application_name: 'statly-private-workbook-readiness-generation',
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    const result = await pool.query<{ generation: string }>(
      'SELECT pg_current_wal_lsn()::text AS generation'
    );
    const generation = result.rows[0]?.generation?.trim();
    if (!generation || !POSTGRES_WAL_LSN_PATTERN.test(generation)) {
      throw new Error('The outcomes readiness generation is invalid.');
    }
    return generation;
  } finally {
    await pool.end();
  }
}

export const privateLocalWorkbookReads = createPrivateLocalWorkbookReads({
  authenticate: getExplicitAuthenticatedUserIdFromServerContext,
  authenticateRuntime: authenticateLocalOutcomesRuntime,
  readValuationReadinessGeneration: readLocalValuationReadinessGeneration,
  inspectValuationReadiness: inspectAdmittedLocalValuationReadiness,
  environment: () => process.env,
  evaluation: localWorkbookEvaluationService,
});
