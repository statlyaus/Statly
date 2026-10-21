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
import {
  aflTradeTradedPlayerTradeLegs,
  loadAflTradeTradedPlayerDraftguruOrigins,
  loadAflTradeTradedPlayerDraftOrigins,
  mergeAflTradeTradedPlayerDraftOrigins,
} from '../src/server/aflTradeIntelligence/modeling/postgresTradedPlayerValueLineFitInputs';
import type { AflTradeTradedPlayerValueEvaluator } from '../src/server/aflTradeIntelligence/modeling/tradedPlayerValueLineContracts';
import { createAflTradeTradedPlayerValueEvaluator } from '../src/server/aflTradeIntelligence/modeling/tradedPlayerValueLineEvaluator';
import {
  aflTradeTradedPlayerValueLineParameters,
  type AflTradeTradedPlayerValueLineFit,
} from '../src/server/aflTradeIntelligence/modeling/tradedPlayerValueLineFit';
import type { AflTradeValueLineFit } from '../src/server/aflTradeIntelligence/modeling/valueLineFit';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeAssetLedger } from '../src/server/aflTradeIntelligence/valuation/assetLedger';
import { buildAflTradeStructure } from '../src/server/aflTradeIntelligence/valuation/tradeStructure';
import type { AflTradeValueLines } from '../src/server/aflTradeIntelligence/valuation/valueLineContracts';
import { computeAflTradeValueLines } from '../src/server/aflTradeIntelligence/valuation/valueLines';
import {
  parseGradingArguments,
  parseSeasons,
  requireOutAbsent,
  writeStoredOutputFile,
  type GradingArguments,
} from './gradingArguments';

/**
 * Computes the private value lines (#789 step 3): every traded asset's value line at each checkpoint
 * and each trade's per-club nets, from a stored value-line fit and one candidate's governed inputs
 * (the asset ledger and the trade structure, `afl-trade-structure/v1`, are rebuilt in process; no
 * realized grade is computed or read). It takes the shared grading arguments (`gradingArguments.ts`)
 * plus the fit file and the last season end, reads only, and its one
 * write is the value lines' evidence record, as the runbook section "Computing the value lines"
 * describes. With `--traded-player-fit` (the traded-player fit command's `--out` file), traded players'
 * open stints are valued by that fit from the evidence it read (its games, draft origins and legs,
 * re-read and refused unless they are the fit's); without it they are pending.
 *
 * Usage:
 *   npm run outcomes:grading:value-lines -- --candidate <external-reconciliation:...> \
 *     --method <hpn-pav-method:...> --seasons 2019-2026 --official-seasons <seasons> \
 *     --benchmark <hpn-pick-benchmark:...> --fit <absolute-path-to-fit.json> --through-season 2026 \
 *     [--traded-player-fit <absolute-path-to-traded-player-fit.json>] \
 *     --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'value-lines';
const MAXIMUM_VALUE_LINES_BYTES = 64 * 1024 * 1024;
const MAXIMUM_FIT_BYTES = 8 * 1024 * 1024;
const OWN = ['--fit', '--through-season', '--traded-player-fit'];

export interface ComputeValueLinesArguments extends GradingArguments {
  fit: string;
  throughSeason: number;
  /** The stored traded-player fit file, or null to leave traded players' open stints pending. */
  tradedPlayerFit: string | null;
}

/**
 * The grader's arguments, plus `--fit` (an absolute path), `--through-season` (one season) and the
 * optional `--traded-player-fit` (an absolute path).
 */
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
  const tradedPlayerFit = own.get('--traded-player-fit') ?? null;
  if (tradedPlayerFit !== null && !isAbsolute(tradedPlayerFit))
    throw new TypeError('--traded-player-fit must be an absolute path.');
  if (tradedPlayerFit === fit)
    throw new TypeError('--traded-player-fit must not be the value-line fit.');
  const parsed = parseGradingArguments(rest, env);
  if (parsed.out === fit) throw new TypeError('--out must not be the fit.');
  if (parsed.out === tradedPlayerFit)
    throw new TypeError('--out must not be the traded-player fit.');
  return { ...parsed, fit, throughSeason, tradedPlayerFit };
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

/**
 * Reads the stored traded-player fit file and checks it with `aflTradeTradedPlayerValueLineParameters`
 * (its schema version and content address) before the database is opened.
 */
export async function readTradedPlayerValueLineFit(
  path: string
): Promise<AflTradeTradedPlayerValueLineFit> {
  const { size } = await stat(path);
  if (size > MAXIMUM_FIT_BYTES) throw new RangeError(`The fit exceeds ${MAXIMUM_FIT_BYTES} bytes.`);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { fitId?: unknown }).fitId !== 'string' ||
    typeof (parsed as { content?: unknown }).content !== 'object' ||
    (parsed as { content?: unknown }).content === null
  )
    throw new TypeError(`${path} is not a sealed traded-player value-line fit.`);
  const fit = parsed as AflTradeTradedPlayerValueLineFit;
  aflTradeTradedPlayerValueLineParameters(fit);
  return fit;
}

/**
 * The traded-player evaluator from the stored fit and the evidence it read, re-read here: the
 * candidate's player legs in the fit's trade seasons, every canonical and reviewed Draftguru draft
 * origin, and the games read model over the fit's seasons. Refused unless they are the fit's.
 */
async function loadTradedPlayerEvaluator(
  client: AflOutcomeSqlClient,
  fit: AflTradeTradedPlayerValueLineFit,
  candidate: Parameters<typeof aflTradeTradedPlayerTradeLegs>[0]
): Promise<AflTradeTradedPlayerValueEvaluator> {
  const { legs, excludedLegs } = aflTradeTradedPlayerTradeLegs(
    candidate,
    fit.content.fitWindow.legsByTradeSeason.map(({ tradeSeason }) => tradeSeason)
  );
  return createAflTradeTradedPlayerValueEvaluator({
    fit,
    legs,
    excludedLegs,
    draftOrigins: mergeAflTradeTradedPlayerDraftOrigins(
      await loadAflTradeTradedPlayerDraftOrigins(client),
      await loadAflTradeTradedPlayerDraftguruOrigins(client)
    ),
    games: await loadAflTradePlayerSeasonGames(client, {
      methodId: fit.content.methodId,
      seasons: fit.content.fitWindow.seasons.map(({ season }) => season),
    }),
  });
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
  const tradedPlayerFit =
    parsed.tradedPlayerFit === null
      ? null
      : await readTradedPlayerValueLineFit(parsed.tradedPlayerFit);
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
    const tradedPlayers =
      tradedPlayerFit === null
        ? undefined
        : await loadTradedPlayerEvaluator(client, tradedPlayerFit, inputs.candidate);
    const valueLines = computeAflTradeValueLines({
      fit,
      ledger,
      games: await loadAflTradePlayerSeasonGames(client, {
        methodId: parsed.methodId,
        seasons: parsed.seasons,
      }),
      candidateId: inputs.candidateId,
      candidate: inputs.candidate,
      structure: buildAflTradeStructure(inputs),
      tradedPlayers,
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
