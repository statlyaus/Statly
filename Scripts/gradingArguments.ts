import { access, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { AflTradeStoredEvidence } from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * The arguments and output helpers the #789 grading commands share: the candidate-input arguments
 * that `loadAflTradeGradingInputs` reads (the asset ledger and the value lines take them),
 * season lists, and the never-overwrite `--out` rule. Nothing here reads a database or grades.
 */

const VALUED = [
  '--candidate',
  '--method',
  '--seasons',
  '--official-seasons',
  '--benchmark',
  '--store-id',
  '--out',
];

export interface GradingArguments {
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
export function parseSeasons(name: string, value: string): number[] {
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

/** Parses the candidate-input arguments; the database must be on loopback. */
export function parseGradingArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): GradingArguments {
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

/** Refuses an existing `--out` before any work, since an output file is never overwritten. */
export async function requireOutAbsent(out: string, noun: string): Promise<void> {
  const exists = await access(out).then(
    () => true,
    () => false
  );
  if (exists) throw new Error(`--out ${out} already exists; a ${noun} is never overwritten.`);
}

/**
 * Writes `--out` after the output is stored, so a refused store never leaves a file that has no
 * custody. A failure here names the stored artifact, which is then the output's only copy.
 */
export async function writeStoredOutputFile(
  out: string,
  bytes: Uint8Array,
  stored: AflTradeStoredEvidence | null,
  noun: string
): Promise<void> {
  try {
    await writeFile(out, bytes, { flag: 'wx' });
  } catch (error) {
    if (stored === null) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The ${noun} was stored as ${stored.reference.artifactId}, but --out was not written: ${reason}`
    );
  }
}
