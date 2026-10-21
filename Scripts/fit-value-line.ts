import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { loadAflTradeValueLineFitInputs } from '../src/server/aflTradeIntelligence/modeling/postgresValueLineFitInputs';
import {
  fitAflTradeValueLine,
  type AflTradeValueLineFit,
} from '../src/server/aflTradeIntelligence/modeling/valueLineFit';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { parseSeasons, requireOutAbsent, writeStoredOutputFile } from './gradingArguments';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Fits and back-tests the value-line priors (#789 step 2): the first-stint pick curve, the survival
 * curve and the credibility weights, from the current canonical national drafts and the player-season
 * games read model, and stores the sealed fit in the registered artifact store, as the runbook section
 * "Fitting the value-line priors" describes. Reads only; the one write is the fit's evidence record.
 *
 * Usage:
 *   npm run outcomes:grading:value-line-fit -- --method <hpn-pav-method:...> \
 *     --draft-years 2011-2025 --last-season 2026 --store-id <store-id> \
 *     --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'value-line-fits';
const MAXIMUM_FIT_BYTES = 8 * 1024 * 1024;
const VALUED = ['--method', '--draft-years', '--last-season', '--store-id', '--out'];

export interface FitValueLineArguments {
  databaseUrl: string;
  methodId: string;
  draftYears: number[];
  lastSeason: number;
  storeId: string | null;
  out: string;
  dryRun: boolean;
}

export function parseFitValueLineArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): FitValueLineArguments {
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
  const draftYears = parseSeasons('--draft-years', required('--draft-years'));
  const [lastSeason] = parseSeasons('--last-season', required('--last-season'));
  if (lastSeason === undefined || values.get('--last-season')!.includes(','))
    throw new TypeError('--last-season must be one season.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    methodId: required('--method'),
    draftYears,
    lastSeason,
    storeId,
    out,
    dryRun,
  };
}

/** Stores the sealed fit as private derived output: it is a calculation, not a source. */
export function storeValueLineFit(
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
    maximumObjectBytes: MAXIMUM_FIT_BYTES,
  });
}

export interface FitValueLineResult {
  fit: AflTradeValueLineFit;
  out: string;
  stored: AflTradeStoredEvidence | null;
}

export async function runFitValueLineCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<FitValueLineResult> {
  const parsed = parseFitValueLineArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'fit');
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const fit = fitAflTradeValueLine(
      await loadAflTradeValueLineFitInputs(client, {
        methodId: parsed.methodId,
        draftYears: parsed.draftYears,
        lastSeason: parsed.lastSeason,
      })
    );
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(fit));
    if (bytes.byteLength > MAXIMUM_FIT_BYTES)
      throw new RangeError(`The fit exceeds ${MAXIMUM_FIT_BYTES} bytes.`);
    const stored = parsed.dryRun ? null : await storeValueLineFit(client, parsed.storeId!, bytes);
    await writeStoredOutputFile(parsed.out, bytes, stored, 'fit');
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        fitId: fit.fitId,
        parameters: fit.content.parameters,
        backTest: fit.content.backTest.byRangeAndCheckpoint,
        out: parsed.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return { fit, out: parsed.out, stored };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runFitValueLineCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Value-line fit stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
