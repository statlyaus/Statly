import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { canonicalizeAflTradeJson } from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { loadAflTradeAssetLedgerLabels } from '../src/server/aflTradeIntelligence/development/postgresAssetLedgerLabels';
import { loadAflTradeRealizedTradeGradeInputs } from '../src/server/aflTradeIntelligence/development/postgresRealizedTradeGradeInputs';
import { loadAflTradePlayerSeasonGames } from '../src/server/aflTradeIntelligence/modeling/postgresPlayerSeasonGames';
import type { AflTradeValueLineFit } from '../src/server/aflTradeIntelligence/modeling/valueLineFit';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeAssetLedger } from '../src/server/aflTradeIntelligence/valuation/assetLedger';
import { gradeAflTradesOnRealizedValue } from '../src/server/aflTradeIntelligence/valuation/realizedTradeGrade';
import type { AflTradeValueLines } from '../src/server/aflTradeIntelligence/valuation/valueLineContracts';
import { computeAflTradeValueLines } from '../src/server/aflTradeIntelligence/valuation/valueLines';
import {
  parseGradeRealizedTradesArguments,
  parseSeasons,
  requireOutAbsent,
  writeStoredOutputFile,
  type GradeRealizedTradesArguments,
} from './grade-realized-trades';

/**
 * Computes the private value lines (#789 step 3): every traded asset's value line at each checkpoint
 * and each trade's per-club nets, from a stored value-line fit and the realized grader's own inputs
 * (the asset ledger and the batch's trades are rebuilt in process, never read for their values). It
 * takes the grader's arguments plus the fit file and the last season end, reads only, and its one
 * write is the value lines' evidence record, as the runbook section "Computing the value lines"
 * describes. No traded-player fit is stored yet, so traded players' open stints are pending.
 *
 * Usage:
 *   npm run outcomes:grading:value-lines -- --candidate <external-reconciliation:...> \
 *     --method <hpn-pav-method:...> --seasons 2019-2026 --official-seasons <seasons> \
 *     --benchmark <hpn-pick-benchmark:...> --fit <absolute-path-to-fit.json> --through-season 2026 \
 *     --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'value-lines';
const MAXIMUM_VALUE_LINES_BYTES = 64 * 1024 * 1024;
const MAXIMUM_FIT_BYTES = 8 * 1024 * 1024;
const OWN = ['--fit', '--through-season'];

export interface ComputeValueLinesArguments extends GradeRealizedTradesArguments {
  fit: string;
  throughSeason: number;
}

/** The grader's arguments, plus `--fit` (an absolute path) and `--through-season` (one season). */
export function parseComputeValueLinesArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): ComputeValueLinesArguments {
  const own = new Map<string, string>();
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]!;
    if (!OWN.includes(name)) {
      rest.push(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new TypeError(`${name} needs a value.`);
    if (own.has(name)) throw new TypeError(`${name} may be given once.`);
    own.set(name, value);
    index++;
  }
  const fit = own.get('--fit');
  if (fit === undefined) throw new TypeError('--fit is required.');
  if (!isAbsolute(fit)) throw new TypeError('--fit must be an absolute path.');
  const season = own.get('--through-season');
  if (season === undefined) throw new TypeError('--through-season is required.');
  const [throughSeason, ...more] = parseSeasons('--through-season', season);
  if (throughSeason === undefined || more.length > 0 || season.includes('-'))
    throw new TypeError('--through-season must be one season.');
  const parsed = parseGradeRealizedTradesArguments(rest, env);
  if (parsed.out === fit) throw new TypeError('--out must not be the fit.');
  return { ...parsed, fit, throughSeason };
}

/** Reads the stored fit file; the calculator checks its schema version and content address. */
export async function readValueLineFit(path: string): Promise<AflTradeValueLineFit> {
  const { size } = await stat(path);
  if (size > MAXIMUM_FIT_BYTES) throw new RangeError(`The fit exceeds ${MAXIMUM_FIT_BYTES} bytes.`);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { fitId?: unknown }).fitId !== 'string' ||
    typeof (parsed as { content?: unknown }).content !== 'object'
  )
    throw new TypeError(`${path} is not a sealed value-line fit.`);
  return parsed as AflTradeValueLineFit;
}

/** Stores the sealed value lines as private derived output: a calculation, not a source. */
export function storeValueLines(
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
    maximumObjectBytes: MAXIMUM_VALUE_LINES_BYTES,
  });
}

export interface ComputeValueLinesResult {
  valueLines: AflTradeValueLines;
  out: string;
  stored: AflTradeStoredEvidence | null;
}

export async function runComputeValueLinesCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<ComputeValueLinesResult> {
  const parsed = parseComputeValueLinesArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'value-lines file');
  const fit = await readValueLineFit(parsed.fit);
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
    const ledger = createAflTradeAssetLedger(inputs, await loadAflTradeAssetLedgerLabels(client));
    const valueLines = computeAflTradeValueLines({
      fit,
      ledger,
      games: await loadAflTradePlayerSeasonGames(client, {
        methodId: parsed.methodId,
        seasons: parsed.seasons,
      }),
      candidateId: inputs.candidateId,
      candidate: inputs.candidate,
      batch: gradeAflTradesOnRealizedValue(inputs),
      throughSeason: parsed.throughSeason,
    });
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(valueLines));
    if (bytes.byteLength > MAXIMUM_VALUE_LINES_BYTES)
      throw new RangeError(`The value lines exceed ${MAXIMUM_VALUE_LINES_BYTES} bytes.`);
    const stored = parsed.dryRun ? null : await storeValueLines(client, parsed.storeId!, bytes);
    await writeStoredOutputFile(parsed.out, bytes, stored, 'value lines');
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        valueLinesId: valueLines.valueLinesId,
        inputs: valueLines.content.inputs,
        summary: valueLines.content.summary,
        out: parsed.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return { valueLines, out: parsed.out, stored };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runComputeValueLinesCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Value lines stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
