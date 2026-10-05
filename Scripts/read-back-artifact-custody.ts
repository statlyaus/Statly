import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  readBackLocalAflTradeArtifactCustody,
  type AflTradeArtifactReadbackRun,
} from '../src/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Reads located evidence back from the registered local non-production store and records one
 * custody readback run: every located raw_source row in full and a sample of the other classes.
 * Reviewed registration requires a clean run under 48 hours old. See the operations runbook section
 * "Custody readback".
 *
 * Usage:
 *   npm run outcomes:artifacts:readback -- --store-id <store-id> \
 *     [--sample-fraction <0..1, default 0.05>] [--report <absolute-report.json>]
 * Exits non-zero when any row fails, after recording the run.
 */

export interface ReadBackArtifactCustodyArguments {
  databaseUrl: string;
  storeId: string;
  sampleFraction: number;
  reportPath: string | null;
}

const VALUE_OPTIONS = new Set(['--store-id', '--sample-fraction', '--report']);

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Custody readback".`);
}

export function parseReadBackArtifactCustodyArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): ReadBackArtifactCustodyArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    const value = argv[index + 1];
    if (!VALUE_OPTIONS.has(name) || value === undefined || value.startsWith('--')) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
  }
  const storeId = values.get('--store-id');
  if (storeId === undefined || !/^[a-z][a-z0-9-]{2,62}$/u.test(storeId)) {
    usage('--store-id must be lowercase letters, digits and hyphens, starting with a letter.');
  }
  const fractionText = values.get('--sample-fraction') ?? '0.05';
  const sampleFraction = Number(fractionText);
  if (
    !/^(0(\.\d+)?|1(\.0+)?)$/u.test(fractionText) ||
    !(sampleFraction >= 0 && sampleFraction <= 1)
  ) {
    usage('--sample-fraction must be a number from 0 to 1.');
  }
  const reportPath = values.get('--report') ?? null;
  if (reportPath !== null && !isAbsolute(reportPath)) usage('--report must be an absolute path.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    storeId,
    sampleFraction,
    reportPath,
  };
}

export async function runReadBackArtifactCustodyCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<AflTradeArtifactReadbackRun> {
  const parsed = parseReadBackArtifactCustodyArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const run = await readBackLocalAflTradeArtifactCustody({
      client: createPgAflOutcomeSqlClient(pool),
      storeId: parsed.storeId,
      otherClassFraction: parsed.sampleFraction,
    });
    if (parsed.reportPath !== null) {
      await writeFile(parsed.reportPath, `${JSON.stringify(run, null, 1)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    write(
      JSON.stringify({ ...run, failingArtifactIds: run.failingArtifactIds.slice(0, 20) }, null, 1)
    );
    return run;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runReadBackArtifactCustodyCommand({ argv: process.argv.slice(2), env: process.env })
    .then((run) => {
      if (run.failures > 0) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Custody readback stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
