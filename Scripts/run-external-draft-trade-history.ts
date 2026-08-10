import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import { runScheduledAflTradeExternalCapture } from '../src/server/aflTradeIntelligence/source/externalDraftTradeScheduledRunner';
import { runAflTradeExternalHistoricalCapturePlanPage } from '../src/server/aflTradeIntelligence/source/externalHistoricalCapturePlanRunner';
import { PostgresAflTradeExternalDiscoveryRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';

const inputSchema = z
  .object({
    planId: z.string().regex(/^external-historical-capture-plan:[a-f0-9]{64}$/),
    afterOrdinal: z.number().int().nonnegative(),
    maximumTargets: z.number().int().min(1).max(1_000),
    workerId: z.string().trim().min(1).max(240),
  })
  .strict();

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('Historical execution requires exactly one --input <worker-json-path>.');
  }
  return argv[1];
}

function parseInput(json: string) {
  try {
    return inputSchema.parse(JSON.parse(json));
  } catch (cause) {
    throw new TypeError('Historical execution input is invalid.', { cause });
  }
}

export async function runAflTradeExternalHistoricalPlanCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  readInput?: (path: string) => Promise<string>;
  writeOutput?: (line: string) => void;
  clock?: { now(): string };
  createRuntime?: (config: AflTradeExternalIngestionConfig) => AflTradeExternalIngestionRuntime;
  createPool?: (databaseUrl: string) => Pool;
  createLeaseTokenSha256?: (ordinal: number) => string;
}) {
  const config = parseAflTradeExternalIngestionConfig(input.env);
  const command = parseInput(
    await (input.readInput ?? ((path) => readFile(path, 'utf8')))(inputPath(input.argv))
  );
  const clock = input.clock ?? { now: () => new Date().toISOString() };
  const pool = (input.createPool ?? ((databaseUrl) => new Pool({ connectionString: databaseUrl })))(
    config.databaseUrl
  );
  const runtime = (input.createRuntime ?? createAflTradeExternalIngestionRuntime)(config);
  const sql = createPgAflOutcomeSqlClient(pool);
  const planRepository = new PostgresAflTradeExternalDiscoveryRepository(sql);
  const scheduleRepository = new PostgresAflTradeExternalCaptureScheduleRepository(sql);
  try {
    const result = await runAflTradeExternalHistoricalCapturePlanPage(command, {
      loadPlanPage: (request) => planRepository.loadFinalizedPlanPage(request),
      runCapture: (request) =>
        runScheduledAflTradeExternalCapture(request, {
          repository: scheduleRepository,
          ingest: (capture) => runtime.ingest(capture),
          clock,
        }),
      clock,
      createLeaseTokenSha256:
        input.createLeaseTokenSha256 ??
        (() => createHash('sha256').update(randomBytes(32)).digest('hex')),
    });
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(result));
    return result;
  } finally {
    await Promise.allSettled([runtime.close(), pool.end()]);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalHistoricalPlanCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External historical plan execution failed; no reconciliation, promotion, release or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
