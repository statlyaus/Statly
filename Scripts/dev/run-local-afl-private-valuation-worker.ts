import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createLocalAflTradePrivateValuationRuntime } from '../../src/server/aflTradeIntelligence/development/localPrivateValuationRuntime';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const POLL_MILLISECONDS = 30_000;

function localConfiguration(environment: NodeJS.ProcessEnv) {
  const databaseUrl = environment.AFL_OUTCOMES_DATABASE_URL?.trim();
  const runtimeNonce = environment.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
  const artifactRoot = environment.AFL_TRADE_LOCAL_ARTIFACT_ROOT?.trim();
  if (!databaseUrl || !runtimeNonce || !artifactRoot || !/^[a-f0-9]{64}$/u.test(runtimeNonce)) {
    throw new Error('The admitted local outcomes database, runtime nonce, and artifact root are required.');
  }
  const database = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOOPBACK_HOSTS.has(database.hostname) ||
    database.pathname !== '/statly_outcomes_test'
  ) {
    throw new Error('The valuation worker requires disposable loopback PostgreSQL.');
  }
  return { databaseUrl, runtimeNonce, artifactRoot };
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

export async function runLocalAflPrivateValuationWorker(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly writeOutput?: (line: string) => void;
  readonly now?: () => string;
  readonly pollMilliseconds?: number;
  readonly createPool?: (databaseUrl: string) => Pool;
  readonly authenticateRuntime?: typeof assertLocalAflTradeOutcomesRuntimeIdentity;
  readonly createRuntime?: typeof createLocalAflTradePrivateValuationRuntime;
}) {
  const config = localConfiguration(input.env);
  const output = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool =
    input.createPool?.(config.databaseUrl) ??
    new Pool({
      connectionString: config.databaseUrl,
      application_name: 'statly-local-private-valuation-worker',
      connectionTimeoutMillis: 5_000,
      max: 8,
    });
  try {
    await (input.authenticateRuntime ?? assertLocalAflTradeOutcomesRuntimeIdentity)(
      pool,
      config.runtimeNonce
    );
    const runtime = (input.createRuntime ?? createLocalAflTradePrivateValuationRuntime)({
      pool,
      artifactRoot: config.artifactRoot,
    });
    await runtime.enqueueStartupCatchUp((input.now ?? (() => new Date().toISOString()))());
    while (!input.signal.aborted) {
      let dispatched = 0;
      try {
        for (;;) {
          const result = await runtime.dispatchOne();
          if (result.state === 'idle') break;
          dispatched += 1;
          output(JSON.stringify(result));
        }
      } catch (error) {
        output(
          JSON.stringify({
            state: 'dispatch_failed',
            message: error instanceof Error ? error.message : 'Unknown valuation worker failure.',
          })
        );
      }
      if (!input.signal.aborted) {
        await wait(input.pollMilliseconds ?? POLL_MILLISECONDS, input.signal);
        try {
          await runtime.enqueueStartupCatchUp((input.now ?? (() => new Date().toISOString()))());
        } catch (error) {
          output(
            JSON.stringify({
              state: 'catch_up_failed',
              message: error instanceof Error ? error.message : 'Unknown valuation worker failure.',
            })
          );
        }
      }
      if (dispatched === 0 && (input.pollMilliseconds ?? POLL_MILLISECONDS) === 0) break;
    }
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  runLocalAflPrivateValuationWorker({ env: process.env, signal: controller.signal }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown valuation worker failure.';
    process.stderr.write(`Local private valuation worker failed closed: ${message}\n`);
    process.exitCode = 1;
  });
}
