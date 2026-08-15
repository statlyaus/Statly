import 'server-only';

import { isAbsolute } from 'node:path';

import { Pool } from 'pg';

import { DEVELOPMENT_AUTH_USER_ID } from '@/lib/devAuth';
import { getExplicitAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from './localOutcomesRuntimeIdentity';
import {
  localWorkbookEvaluationService,
  type LocalWorkbookEvaluationEnvironment,
  type LocalWorkbookEvaluationService,
} from './localWorkbookEvaluation';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface PrivateLocalWorkbookReadEnvironment extends LocalWorkbookEvaluationEnvironment {
  STATLY_ENABLE_DEV_TOOLS?: string;
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?: string;
}

type ArchiveQuery = Parameters<LocalWorkbookEvaluationService['loadArchive']>[0];
type ArchiveResult = ReturnType<LocalWorkbookEvaluationService['loadArchive']>;
type TradeResult = ReturnType<LocalWorkbookEvaluationService['loadTrade']>;

export interface PrivateLocalWorkbookReads {
  loadArchive(query: ArchiveQuery): ArchiveResult;
  loadTrade(tradeId: string): TradeResult;
}

export interface PrivateLocalWorkbookReadDependencies {
  authenticate(): Promise<string | null>;
  authenticateRuntime(environment: Readonly<PrivateLocalWorkbookReadEnvironment>): Promise<void>;
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

  return {
    async loadArchive(query) {
      const environment = await admit();
      if (environment === null) return null;
      return dependencies.evaluation.loadArchive(query, environment);
    },

    async loadTrade(tradeId) {
      const environment = await admit();
      if (environment === null) return null;
      return dependencies.evaluation.loadTrade(tradeId, environment);
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

export const privateLocalWorkbookReads = createPrivateLocalWorkbookReads({
  authenticate: getExplicitAuthenticatedUserIdFromServerContext,
  authenticateRuntime: authenticateLocalOutcomesRuntime,
  environment: () => process.env,
  evaluation: localWorkbookEvaluationService,
});
