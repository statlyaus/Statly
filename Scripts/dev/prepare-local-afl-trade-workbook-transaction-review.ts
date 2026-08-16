import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  loadAflOutcomesDevelopmentWorkbookEvidence,
  type AflOutcomesDevelopmentWorkbookEvidence,
} from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { PostgresAflTradeWorkbookTransactionReviewRepository } from '../../src/server/aflTradeIntelligence/source/postgresWorkbookTransactionReviewRepository';
import { createAflTradeWorkbookTransactionReviewSet } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewSet';
import type { AflTradeWorkbookTransactionReviewSet } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewSet';

interface CommandConnection {
  register(input: {
    importRunId: string;
    staging: AflOutcomesDevelopmentWorkbookEvidence['staging'];
  }): Promise<AflTradeWorkbookTransactionReviewSet>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string, runtimeNonce: string): Promise<CommandConnection>;
  loadEvidence(input: {
    workbookPath: string;
    expectedSha256: string;
    runtimeEnvironment: string;
  }): Promise<Pick<AflOutcomesDevelopmentWorkbookEvidence, 'staging'>>;
  loadRuntimeNonce(configuredNonce: string | undefined): Promise<string>;
  writeOutput(line: string): void;
}

const commandSchema = z
  .tuple([z.literal('--import-run'), z.string().regex(/^workbook-import-run:[a-f0-9]{64}$/)])
  .transform(([, importRunId]) => ({ importRunId }));
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const root = resolve(import.meta.dirname, '../..');

function parseCommand(argv: readonly string[]) {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError('The command requires --import-run <workbook-import-run content address>.');
  }
  return parsed.data;
}

function requiredEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const databaseUrl = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!databaseUrl) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  const parsedUrl = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsedUrl.hostname) ||
    parsedUrl.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('The workbook review requires loopback statly_outcomes_test.');
  }
  const workbookPath = env.AFL_OUTCOMES_DEV_WORKBOOK_PATH?.trim();
  if (!workbookPath) throw new TypeError('AFL_OUTCOMES_DEV_WORKBOOK_PATH is required.');
  const digest = digestSchema.safeParse(env.AFL_OUTCOMES_DEV_WORKBOOK_SHA256?.trim());
  if (!digest.success) throw new TypeError('AFL_OUTCOMES_DEV_WORKBOOK_SHA256 is required.');
  const runtimeEnvironment = env.NODE_ENV?.trim() || 'development';
  if (runtimeEnvironment === 'production') {
    throw new TypeError('Private workbook review is disabled in production.');
  }
  return { databaseUrl, workbookPath, expectedSha256: digest.data, runtimeEnvironment };
}

async function connectPostgres(
  databaseUrl: string,
  runtimeNonce: string
): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const repository = new PostgresAflTradeWorkbookTransactionReviewRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  return {
    register: ({ importRunId, staging }) =>
      repository.registerReviewSet({
        importRunId,
        reviewSet: createAflTradeWorkbookTransactionReviewSet(staging),
      }),
    close: () => pool.end(),
  };
}

async function loadRuntimeNonce(configuredNonce: string | undefined): Promise<string> {
  const nonce = (
    configuredNonce ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(nonce)) {
    throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE is invalid.');
  }
  return nonce;
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  loadEvidence: loadAflOutcomesDevelopmentWorkbookEvidence,
  loadRuntimeNonce,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runPrepareLocalAflTradeWorkbookTransactionReviewCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: Partial<CommandDependencies> &
    Pick<CommandDependencies, 'connect' | 'loadEvidence' | 'writeOutput'> = defaultDependencies
): Promise<AflTradeWorkbookTransactionReviewSet> {
  const command = parseCommand(input.argv);
  const config = requiredEnvironment(input.env);
  const loadNonce = dependencies.loadRuntimeNonce ?? defaultDependencies.loadRuntimeNonce;
  const runtimeNonce = await loadNonce(input.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE);
  const connection = await dependencies.connect(config.databaseUrl, runtimeNonce);
  try {
    const evidence = await dependencies.loadEvidence({
      workbookPath: config.workbookPath,
      expectedSha256: config.expectedSha256,
      runtimeEnvironment: config.runtimeEnvironment,
    });
    const reviewSet = await connection.register({
      importRunId: command.importRunId,
      staging: evidence.staging,
    });
    dependencies.writeOutput(
      JSON.stringify({
        mode: 'private_local_workbook_transaction_review',
        productionAuthority: 'none',
        publicationAuthority: 'none',
        importRunId: command.importRunId,
        reviewSetId: reviewSet.reviewSetId,
        transactionCount: reviewSet.content.transactionCount,
        pendingReviewCount: reviewSet.content.pendingReviewCount,
      })
    );
    return reviewSet;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runPrepareLocalAflTradeWorkbookTransactionReviewCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Local workbook transaction review preparation failed; no approval, release, publication, or activation was assumed.\n'
    );
    process.exitCode = 1;
  });
}
