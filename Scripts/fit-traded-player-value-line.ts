import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { loadAflTradeTradedPlayerValueLineFitInputs } from '../src/server/aflTradeIntelligence/modeling/postgresTradedPlayerValueLineFitInputs';
import {
  fitAflTradeTradedPlayerValueLine,
  type AflTradeTradedPlayerValueLineFit,
} from '../src/server/aflTradeIntelligence/modeling/tradedPlayerValueLineFit';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { parseSeasons, requireOutAbsent, writeStoredOutputFile } from './gradingArguments';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Fits and back-tests the traded-player value line (#789, owner decision 2026-10-19): the career-stage
 * prior, survival at the receiving club and the credibility weights, from one reconciliation
 * candidate's player trade legs, their ledger stints, the canonical draft rows and the player-season
 * games read model, and stores the sealed fit in the registered artifact store, as the runbook section
 * "Fitting the traded-player value line" describes. Reads only; the one write is the fit's evidence
 * record.
 *
 * Usage:
 *   npm run outcomes:grading:traded-player-value-line-fit -- \
 *     --candidate <external-reconciliation:...> --method <hpn-pav-method:...> \
 *     --trade-seasons 2019-2025 --seasons 2011-2026 --official-seasons <seasons> \
 *     --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'traded-player-value-line-fits';
const MAXIMUM_FIT_BYTES = 8 * 1024 * 1024;
const VALUED = [
  '--candidate',
  '--method',
  '--trade-seasons',
  '--seasons',
  '--official-seasons',
  '--store-id',
  '--out',
];

export interface FitTradedPlayerValueLineArguments {
  databaseUrl: string;
  candidateId: string;
  methodId: string;
  tradeSeasons: number[];
  seasons: number[];
  officialSeasons: number[];
  storeId: string | null;
  out: string;
  dryRun: boolean;
}

export function parseFitTradedPlayerValueLineArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): FitTradedPlayerValueLineArguments {
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
  const tradeSeasons = parseSeasons('--trade-seasons', required('--trade-seasons'));
  const seasons = parseSeasons('--seasons', required('--seasons'));
  if (seasons[0]! > tradeSeasons[0]!)
    throw new TypeError('--seasons must start at or before the first trade season.');
  if (seasons[seasons.length - 1]! <= tradeSeasons[tradeSeasons.length - 1]!)
    throw new TypeError('--seasons must end after the last trade season.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    candidateId: required('--candidate'),
    methodId: required('--method'),
    tradeSeasons,
    seasons,
    officialSeasons: parseSeasons('--official-seasons', required('--official-seasons')),
    storeId,
    out,
    dryRun,
  };
}

/** Stores the sealed fit as private derived output: it is a calculation, not a source. */
export function storeTradedPlayerValueLineFit(
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

export interface FitTradedPlayerValueLineResult {
  fit: AflTradeTradedPlayerValueLineFit;
  out: string;
  stored: AflTradeStoredEvidence | null;
}

export async function runFitTradedPlayerValueLineCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<FitTradedPlayerValueLineResult> {
  const parsed = parseFitTradedPlayerValueLineArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'fit');
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const fit = fitAflTradeTradedPlayerValueLine(
      await loadAflTradeTradedPlayerValueLineFitInputs(client, {
        candidateId: parsed.candidateId,
        methodId: parsed.methodId,
        tradeSeasons: parsed.tradeSeasons,
        seasons: parsed.seasons,
        officialSeasons: parsed.officialSeasons,
        spellCutoffAt: new Date().toISOString(),
      })
    );
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(fit));
    if (bytes.byteLength > MAXIMUM_FIT_BYTES)
      throw new RangeError(`The fit exceeds ${MAXIMUM_FIT_BYTES} bytes.`);
    const stored = parsed.dryRun
      ? null
      : await storeTradedPlayerValueLineFit(client, parsed.storeId!, bytes);
    await writeStoredOutputFile(parsed.out, bytes, stored, 'fit');
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        fitId: fit.fitId,
        legs: fit.content.legs,
        parameters: fit.content.parameters,
        backTest: fit.content.backTest.byStageBandAndCheckpoint,
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
  runFitTradedPlayerValueLineCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Traded-player value-line fit stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
