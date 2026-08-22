import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createLocalAflTradePrivateValuationRuntime } from '../../src/server/aflTradeIntelligence/development/localPrivateValuationRuntime';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const idSchema = z.string().trim().min(1).max(400);

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1]?.trim();
}

function parseArguments(argv: readonly string[]) {
  const scopeKey = idSchema.parse(argument(argv, '--scope'));
  const operationKey = argument(argv, '--operation');
  const repairReason = argument(argv, '--repair-reason');
  const repairOperationId = argument(argv, '--repair-operation');
  if ((repairReason === undefined) !== (repairOperationId === undefined)) {
    throw new TypeError('Repair requires both --repair-reason and --repair-operation.');
  }
  if (operationKey === undefined) {
    throw new TypeError('Ad-hoc execution requires a stable --operation key for crash replay.');
  }
  return {
    scopeKey,
    operationKey: idSchema.parse(operationKey),
    repairReason:
      repairReason === undefined ? null : z.string().trim().min(1).max(2_000).parse(repairReason),
    repairOperationId:
      repairOperationId === undefined
        ? null
        : z.string().regex(/^cohort-execution-repair:[a-f0-9]{64}$/).parse(repairOperationId),
  };
}

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
    throw new Error('Private valuation execution requires disposable loopback PostgreSQL.');
  }
  return { databaseUrl, runtimeNonce, artifactRoot };
}

export async function runLocalAflPrivateValuationCommand(input: {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly writeOutput?: (line: string) => void;
}) {
  const command = parseArguments(input.argv);
  const config = localConfiguration(input.env);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    application_name: 'statly-local-private-valuation-command',
    connectionTimeoutMillis: 5_000,
    max: 4,
  });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, config.runtimeNonce);
    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool,
      artifactRoot: config.artifactRoot,
      workerId: 'system:ad-hoc-valuation-command',
    });
    if (command.repairReason !== null && command.repairOperationId !== null) {
      await runtime.repairCurrent(
        command.scopeKey,
        command.repairReason,
        command.repairOperationId
      );
    }
    const requestId = await runtime.enqueueAdHoc({
      scopeKey: command.scopeKey,
      operationKey: command.operationKey,
    });
    let dispatched: Awaited<ReturnType<typeof runtime.dispatchRequest>>;
    for (;;) {
      dispatched = await runtime.dispatchRequest(requestId);
      if (dispatched.state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({ requestId, result: dispatched.result })
    );
    return dispatched.result;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runLocalAflPrivateValuationCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    () => {
      process.stderr.write('Local private valuation execution failed closed.\n');
      process.exitCode = 1;
    }
  );
}
