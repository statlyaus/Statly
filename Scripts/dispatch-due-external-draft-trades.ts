import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeExternalIngestionRuntime,
  type AflTradeExternalIngestionRuntime,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionRuntime';
import {
  parseAflTradeExternalIngestionConfig,
  type AflTradeExternalIngestionConfig,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionConfig';
import {
  dispatchDueAflTradeExternalCaptures,
  type AflTradeExternalCaptureDispatcherDependencies,
} from '../src/server/aflTradeIntelligence/source/externalDraftTradeCaptureDispatcher';
import { runScheduledAflTradeExternalCapture } from '../src/server/aflTradeIntelligence/source/externalDraftTradeScheduledRunner';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';

const commandSchema = z
  .object({
    workerId: z.string().trim().min(1).max(240),
    maximumOccurrences: z.number().int().min(1).max(1_000),
  })
  .strict();

interface DispatchPool {
  end(): Promise<void>;
}

type DispatchRepository = AflTradeExternalCaptureDispatcherDependencies['repository'] &
  Parameters<typeof runScheduledAflTradeExternalCapture>[1]['repository'];

function parseArguments(argv: readonly string[]) {
  if (
    argv.length !== 4 ||
    argv[0] !== '--worker' ||
    argv[2] !== '--limit' ||
    argv[1]?.trim() === ''
  ) {
    throw new TypeError('Dispatch requires --worker <id> --limit <1..1000>.');
  }
  return commandSchema.parse({
    workerId: argv[1],
    maximumOccurrences: Number(argv[3]),
  });
}

export async function runAflTradeExternalCaptureDispatchCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  clock?: { now(): string };
  createPool?: (databaseUrl: string) => DispatchPool;
  createRuntime?: (config: AflTradeExternalIngestionConfig) => AflTradeExternalIngestionRuntime;
  createRepository?: (pool: DispatchPool) => DispatchRepository;
  createLeaseTokenSha256?: () => string;
  dispatchDue?: typeof dispatchDueAflTradeExternalCaptures;
  writeOutput?: (line: string) => void;
}) {
  const config = parseAflTradeExternalIngestionConfig(input.env);
  const command = parseArguments(input.argv);
  const clock = input.clock ?? { now: () => new Date().toISOString() };
  const pool =
    input.createPool?.(config.databaseUrl) ?? new Pool({ connectionString: config.databaseUrl });
  const runtime = (input.createRuntime ?? createAflTradeExternalIngestionRuntime)(config);
  const repository =
    input.createRepository?.(pool) ??
    new PostgresAflTradeExternalCaptureScheduleRepository(
      createPgAflOutcomeSqlClient(pool as Pool)
    );
  try {
    const result = await (input.dispatchDue ?? dispatchDueAflTradeExternalCaptures)(
      {
        environment: config.environment,
        observedAt: clock.now(),
        workerId: command.workerId,
        maximumOccurrences: command.maximumOccurrences,
      },
      {
        repository,
        createLeaseTokenSha256:
          input.createLeaseTokenSha256 ??
          (() => createHash('sha256').update(randomBytes(32)).digest('hex')),
        runOccurrence: (occurrence) =>
          runScheduledAflTradeExternalCapture(occurrence, {
            repository,
            ingest: (capture) => runtime.ingest(capture),
            clock,
          }),
      }
    );
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(result));
    return result;
  } finally {
    await Promise.allSettled([runtime.close(), pool.end()]);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalCaptureDispatchCommand({ argv: process.argv.slice(2), env: process.env })
    .then((result) => {
      if (result.results.some(({ status }) => status === 'dispatch_failed')) process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        'External AFL draft/trade dispatch failed; no reconciliation or publication was assumed.\n'
      );
      process.exitCode = 1;
    });
}
