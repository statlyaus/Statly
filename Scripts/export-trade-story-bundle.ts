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
import { loadAflTradeGradingInputs } from '../src/server/aflTradeIntelligence/development/postgresGradingInputs';
import {
  createAflTradeStoryBundle,
  type AflTradeStoryBundle,
} from '../src/server/aflTradeIntelligence/development/tradeStoryBundle';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeAssetLedger } from '../src/server/aflTradeIntelligence/valuation/assetLedger';
import { buildAflTradeStructure } from '../src/server/aflTradeIntelligence/valuation/tradeStructure';
import type { AflTradeValueLines } from '../src/server/aflTradeIntelligence/valuation/valueLineContracts';
import {
  parseGradingArguments,
  requireOutAbsent,
  writeStoredOutputFile,
  type GradingArguments,
} from './gradingArguments';

/**
 * Exports the private trade page's genuine bundle (statlyaus/Statly#789, #1052): the stored value lines
 * (`--value-lines`, the value-lines command's `--out` file), the trade structure rebuilt in process from
 * the same governed inputs (refused unless it is the one the lines were computed on), the club, player
 * and pick names, and the ledger's matched bids. It reads only; its one write is the bundle's evidence
 * record (`derived_private`). Copy the `--out` file to a development machine and point
 * `AFL_TRADE_STORY_BUNDLE_PATH` at it.
 *
 * Usage:
 *   npm run outcomes:grading:trade-story-bundle -- --candidate <external-reconciliation:...> \
 *     --method <hpn-pav-method:...> --seasons 2019-2026 --official-seasons <seasons> \
 *     --benchmark <hpn-pick-benchmark:...> --value-lines <absolute-path-to-value-lines.json> \
 *     --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

const REPOSITORY_ID = 'trade-story-bundles';
const MAXIMUM_BUNDLE_BYTES = 96 * 1024 * 1024;
const MAXIMUM_VALUE_LINES_BYTES = 64 * 1024 * 1024;

export interface TradeStoryBundleArguments extends GradingArguments {
  valueLines: string;
}

/** The shared grading arguments plus `--value-lines` (an absolute path). */
export function parseTradeStoryBundleArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): TradeStoryBundleArguments {
  const index = argv.indexOf('--value-lines');
  if (index < 0) throw new TypeError('--value-lines is required.');
  const valueLines = argv[index + 1];
  if (valueLines === undefined || valueLines.startsWith('--'))
    throw new TypeError('--value-lines needs a value.');
  if (argv.indexOf('--value-lines', index + 1) >= 0)
    throw new TypeError('--value-lines may be given once.');
  if (!isAbsolute(valueLines)) throw new TypeError('--value-lines must be an absolute path.');
  const parsed = parseGradingArguments(
    argv.filter((_, position) => position !== index && position !== index + 1),
    env
  );
  if (parsed.out === valueLines) throw new TypeError('--out must not be the value lines.');
  return { ...parsed, valueLines };
}

async function readValueLines(path: string): Promise<AflTradeValueLines> {
  const { size } = await stat(path);
  if (size > MAXIMUM_VALUE_LINES_BYTES)
    throw new RangeError(`The value lines exceed ${MAXIMUM_VALUE_LINES_BYTES} bytes.`);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { valueLinesId?: unknown }).valueLinesId !== 'string'
  )
    throw new TypeError(`${path} is not sealed value lines.`);
  return parsed as AflTradeValueLines;
}

export async function runTradeStoryBundleCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<{ bundle: AflTradeStoryBundle; stored: AflTradeStoredEvidence | null }> {
  const parsed = parseTradeStoryBundleArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'trade story bundle');
  const valueLines = await readValueLines(parsed.valueLines);
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const now = new Date().toISOString();
    const inputs = await loadAflTradeGradingInputs(client, {
      candidateId: parsed.candidateId,
      methodId: parsed.methodId,
      seasons: parsed.seasons,
      officialSeasons: parsed.officialSeasons,
      pickProjectionBenchmarkId: parsed.benchmarkId,
      spellCutoffAt: now,
      gradedAt: now,
    });
    const labels = await loadAflTradeAssetLedgerLabels(client);
    const bundle = createAflTradeStoryBundle({
      structure: buildAflTradeStructure(inputs),
      valueLines,
      ledger: createAflTradeAssetLedger(inputs, labels),
      labels,
      transfers: inputs.candidate.transfers,
    });
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(bundle));
    if (bytes.byteLength > MAXIMUM_BUNDLE_BYTES)
      throw new RangeError(`The bundle exceeds ${MAXIMUM_BUNDLE_BYTES} bytes.`);
    const stored = parsed.dryRun
      ? null
      : await storeLocalAflTradeEvidence(client, {
          storeId: parsed.storeId!,
          repositoryId: REPOSITORY_ID,
          artifactClass: 'derived_private',
          bytes,
          mediaType: 'application/json',
          maximumObjectBytes: MAXIMUM_BUNDLE_BYTES,
        });
    await writeStoredOutputFile(parsed.out, bytes, stored, 'trade story bundle');
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        bundleId: bundle.bundleId,
        valueLinesId: valueLines.valueLinesId,
        structureId: bundle.content.structure.structureId,
        trades: bundle.content.structure.content.trades.length,
        bidMatches: bundle.content.bidMatches.length,
        out: parsed.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return { bundle, stored };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runTradeStoryBundleCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Trade story bundle stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
