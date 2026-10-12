import { access, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadAflTradeRealizedTradeGradeInputs } from '../src/server/aflTradeIntelligence/development/postgresRealizedTradeGradeInputs';
import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import { gradeAflTradesOnRealizedValue } from '../src/server/aflTradeIntelligence/valuation/realizedTradeGrade';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Grades every trade in one reconciliation candidate on realized first-stint value (#789) and stores
 * the sealed private batch in the registered artifact store, as the runbook section "Grading trades
 * on realized value (MVP)" describes. Reads only; the one write is the batch's evidence record.
 *
 * Usage:
 *   npm run outcomes:grading:realized -- --candidate <external-reconciliation:...> \
 *     --method <hpn-pav-method:...> --seasons 2021-2026 --official-seasons 2021-2025 \
 *     --benchmark <hpn-pick-benchmark:...> --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'realized-trade-grades';
const MAXIMUM_BATCH_BYTES = 64 * 1024 * 1024;
const VALUED = [
  '--candidate',
  '--method',
  '--seasons',
  '--official-seasons',
  '--benchmark',
  '--store-id',
  '--out',
];

export interface GradeRealizedTradesArguments {
  databaseUrl: string;
  candidateId: string;
  methodId: string;
  seasons: number[];
  officialSeasons: number[];
  benchmarkId: string;
  storeId: string | null;
  out: string;
  dryRun: boolean;
}

/** `2021-2026` or `2021,2022`: distinct seasons, ascending. */
function parseSeasons(name: string, value: string): number[] {
  const range = /^(\d{4})-(\d{4})$/.exec(value);
  if (range && Number(range[1]) > Number(range[2]))
    throw new TypeError(`${name} must be an ascending season range like 2021-2026.`);
  const seasons = range
    ? Array.from(
        { length: Number(range[2]) - Number(range[1]) + 1 },
        (_, i) => Number(range[1]) + i
      )
    : value.split(',').map(Number);
  if (
    seasons.length === 0 ||
    seasons.some((season) => !Number.isInteger(season) || season < 1897 || season > 2200) ||
    new Set(seasons).size !== seasons.length
  )
    throw new TypeError(`${name} must be a season range like 2021-2026 or distinct seasons.`);
  return [...seasons].sort((left, right) => left - right);
}

export function parseGradeRealizedTradesArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): GradeRealizedTradesArguments {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]!;
    if (name === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!VALUED.includes(name)) throw new TypeError(`Unexpected argument ${name}.`);
    if (value === undefined || value.startsWith('--'))
      throw new TypeError(`${name} needs a value.`);
    if (values.has(name)) throw new TypeError(`${name} may be given once.`);
    values.set(name, value);
    index++;
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new TypeError(`${name} is required.`);
    return value;
  };
  const out = required('--out');
  if (!isAbsolute(out)) throw new TypeError('--out must be an absolute path.');
  const storeId = values.get('--store-id') ?? null;
  if (!dryRun && storeId === null) throw new TypeError('--store-id is required unless --dry-run.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    candidateId: required('--candidate'),
    methodId: required('--method'),
    seasons: parseSeasons('--seasons', required('--seasons')),
    officialSeasons: parseSeasons('--official-seasons', required('--official-seasons')),
    benchmarkId: required('--benchmark'),
    storeId,
    out,
    dryRun,
  };
}

/** Stores the sealed batch as private derived output: it is a calculation, not a source. */
export function storeRealizedTradeGradeBatch(
  client: AflOutcomeSqlClient,
  storeId: string,
  bytes: Uint8Array
): Promise<AflTradeStoredEvidence> {
  return storeLocalAflTradeEvidence(client, {
    storeId,
    repositoryId: REPOSITORY_ID,
    artifactClass: 'derived_private',
    bytes,
    mediaType: 'application/json',
    maximumObjectBytes: MAXIMUM_BATCH_BYTES,
  });
}

/** Refuses an existing `--out` before any work, since the batch file is never overwritten. */
async function requireOutAbsent(out: string): Promise<void> {
  const exists = await access(out).then(
    () => true,
    () => false
  );
  if (exists) throw new Error(`--out ${out} already exists; a batch is never overwritten.`);
}

/**
 * Writes `--out` after the batch is stored, so a refused store never leaves a batch file that has
 * no custody. A failure here names the stored artifact, which is then the batch's only copy.
 */
async function writeBatchFile(
  out: string,
  bytes: Uint8Array,
  stored: AflTradeStoredEvidence | null
): Promise<void> {
  try {
    await writeFile(out, bytes, { flag: 'wx' });
  } catch (error) {
    if (stored === null) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The batch was stored as ${stored.reference.artifactId}, but --out was not written: ${reason}`
    );
  }
}

export interface GradeRealizedTradesResult {
  batchId: string;
  summary: Record<string, number>;
  out: string;
  stored: AflTradeStoredEvidence | null;
}

export async function runGradeRealizedTradesCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<GradeRealizedTradesResult> {
  const parsed = parseGradeRealizedTradesArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out);
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const now = new Date().toISOString();
    const inputs = await loadAflTradeRealizedTradeGradeInputs(client, {
      candidateId: parsed.candidateId,
      methodId: parsed.methodId,
      seasons: parsed.seasons,
      officialSeasons: parsed.officialSeasons,
      pickProjectionBenchmarkId: parsed.benchmarkId,
      spellCutoffAt: now,
      gradedAt: now,
    });
    const batch = gradeAflTradesOnRealizedValue(inputs);
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(batch));
    if (bytes.byteLength > MAXIMUM_BATCH_BYTES)
      throw new RangeError(`The batch exceeds ${MAXIMUM_BATCH_BYTES} bytes.`);
    const stored = parsed.dryRun
      ? null
      : await storeRealizedTradeGradeBatch(client, parsed.storeId!, bytes);
    await writeBatchFile(parsed.out, bytes, stored);
    const result = {
      batchId: batch.batchId,
      summary: batch.content.summary,
      out: parsed.out,
      stored,
    };
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        batchId: result.batchId,
        summary: result.summary,
        out: result.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return result;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runGradeRealizedTradesCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Realized grading stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
