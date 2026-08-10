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
import { aflTradeExternalCaptureScheduleSchema } from '../src/server/aflTradeIntelligence/source/externalDraftTradeScheduling';
import { PostgresAflTradeExternalCaptureScheduleRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeScheduleRepository';

const inputSchema = z
  .object({
    schedule: aflTradeExternalCaptureScheduleSchema,
    dueAt: z.iso.datetime({ offset: true }),
    workerId: z.string().trim().min(1).max(240),
  })
  .strict();

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The scheduler requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function parseInput(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The external capture schedule input is not valid JSON.', { cause });
  }
  return inputSchema.parse(value);
}

export async function runAflTradeExternalCaptureScheduleCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  readInput?: (path: string) => Promise<string>;
  writeOutput?: (line: string) => void;
  clock?: { now(): string };
  createRuntime?: (config: AflTradeExternalIngestionConfig) => AflTradeExternalIngestionRuntime;
  createPool?: (databaseUrl: string) => Pool;
  createLeaseTokenSha256?: () => string;
}) {
  const config = parseAflTradeExternalIngestionConfig(input.env);
  const command = parseInput(
    await (input.readInput ?? ((path) => readFile(path, 'utf8')))(inputPath(input.argv))
  );
  if (command.schedule.definition.requestTemplate.environment !== config.environment) {
    throw new TypeError('The reviewed schedule environment must match the runtime environment.');
  }
  const clock = input.clock ?? { now: () => new Date().toISOString() };
  const pool = (input.createPool ?? ((databaseUrl) => new Pool({ connectionString: databaseUrl })))(
    config.databaseUrl
  );
  const runtime = (input.createRuntime ?? createAflTradeExternalIngestionRuntime)(config);
  const repository = new PostgresAflTradeExternalCaptureScheduleRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  try {
    const observedAt = clock.now();
    const registration = await repository.register(command.schedule, observedAt);
    const result = await runScheduledAflTradeExternalCapture(
      {
        scheduleId: command.schedule.scheduleId,
        dueAt: command.dueAt,
        observedAt,
        workerId: command.workerId,
        leaseTokenSha256:
          input.createLeaseTokenSha256?.() ??
          createHash('sha256').update(randomBytes(32)).digest('hex'),
      },
      { repository, ingest: (capture) => runtime.ingest(capture), clock }
    );
    const output = { scheduleId: command.schedule.scheduleId, registration, result };
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(output));
    return output;
  } finally {
    await Promise.allSettled([runtime.close(), pool.end()]);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalCaptureScheduleCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Scheduled external AFL draft/trade capture failed; no reconciliation or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
