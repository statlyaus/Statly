import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../src/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradePlayerSeasonGames } from '../src/server/aflTradeIntelligence/modeling/playerSeasonGames';
import { loadAflTradePlayerSeasonGames } from '../src/server/aflTradeIntelligence/modeling/postgresPlayerSeasonGames';
import { loadAflTradeValueLineDraftees } from '../src/server/aflTradeIntelligence/modeling/postgresValueLineDraftees';
import {
  aflTradeValueLinePickCurve,
  backtestAflTradeValueLine,
} from '../src/server/aflTradeIntelligence/modeling/valueLineBacktest';
import {
  AFL_TRADE_VALUE_LINE_FIT_RULES,
  fitAflTradeValueLine,
  type AflTradeValueLineDraftee,
} from '../src/server/aflTradeIntelligence/modeling/valueLineFit';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { parseSeasons, requireOutAbsent, writeStoredOutputFile } from './grade-realized-trades';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Fits and back-tests the value-line method (#789, implementation order step 2) and exports the
 * parameters as a content-addressed, private JSON artifact: the first-stint pick curve, survival and
 * games by slot band and tenure, k, and the out-of-sample back-test against HPN DPVC v3.0. It reads
 * the current canonical national drafts and the player-season games read model, read-only; the one
 * write is the fit's evidence record (runbook "Fitting the value line").
 *
 * Usage:
 *   AFL_OUTCOMES_DATABASE_URL=<loopback url> npm run outcomes:grading:value-line-fit -- \
 *     --method <hpn-pav-method:...> --seasons 2011-2026 --draft-years 2011-2025 \
 *     --held-out-draft-years 2017-2019 --store-id <store-id> --out <absolute-path.json> [--dry-run]
 */

export const AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION = 'afl-trade-value-line-fit/v1' as const;
const REPOSITORY_ID = 'value-line-fits';
const MAXIMUM_FIT_BYTES = 16 * 1024 * 1024;
const PICK_CURVE_THROUGH = 100;

/** The modelling choices the spec leaves open, recorded with every fit for the owner to confirm. */
export const AFL_TRADE_VALUE_LINE_FIT_DECISIONS: readonly string[] = [
  'Fit data: current canonical AFLM national-draft selections (every selection, including father-son, academy and compensation picks, at the slot it was used) and the player-season games read model; busts kept in.',
  'First stint: from the season after the draft at the drafting club, ended by the first season the player appears for another club, or by two full seasons with no game for the club (read as a delisting or retirement, which appearances alone cannot show).',
  'Survival: Kaplan-Meier retention by slot band (1-10, 11-30, 31+) and tenure; a stint still running at the last season read is censored; tenures with fewer than 20 draftees at risk use the pooled hazard of the last three supported tenures.',
  'Expected games: the band mean games at the club per tenure (supported tenures only, the last supported mean beyond), scaled so the slot total follows a fitted log curve of expected first-stint games; censored stints are completed with the band expectation for that curve only.',
  'Prior PAV per game by slot: max(0, a + b ln(slot)), games-weighted least squares over every season at the club with a game. The rate has no tenure or age term; tenure since the draft stands in for age.',
  'Pick curve: prior rate × expected first-stint games, the same expression the value line gives at the draft.',
  'Form: PAV per game over the last three seasons at the club, weighted 1, 2, 3 (oldest to newest), as weighted PAV over weighted games; Z counts the unweighted games in the window.',
  'Availability: expected games = prior games + rho × (own mean games − prior mean games) over the form window, rho fitted by least squares through the origin on next-season games and clamped to [0, 1].',
  'k: the integer in 0..2000 that minimises the games-weighted squared error between the blended rate and the rest of the observed stint’s PAV per game, over every tenure of every training stint.',
  'Horizon: expectations sum 20 seasons after the draft; this truncates the arithmetic, it is not a cap on the stint.',
  'Back-test: the latest classes with at least seven seasons are held out whole; each checkpoint (draft, year 1, year 3) refits on the training classes from seasons up to that checkpoint only, and compares the line cut at the last season read with the PAV the first stints produced through it. DPVC v3.0 is whole-career and is not cut.',
];

export const AFL_TRADE_VALUE_LINE_FIT_LIMITATION =
  'Private, non-production fit of the value-line method. Realized PAV and value lines are ' +
  'publication-prohibited. Stints come from appearances: a delisting or retirement is inferred from ' +
  'two seasons without a game, and a return to the drafting club after no game elsewhere reads as one ' +
  'stint. Traded players (age and position prior) are not fitted here. Not for publication.';

export interface ExportValueLineFitArguments {
  databaseUrl: string;
  methodId: string;
  seasons: number[];
  draftYears: number[];
  heldOutDraftYears: number[];
  storeId: string | null;
  out: string;
  dryRun: boolean;
}

const VALUED = [
  '--method',
  '--seasons',
  '--draft-years',
  '--held-out-draft-years',
  '--store-id',
  '--out',
];

export function parseExportValueLineFitArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): ExportValueLineFitArguments {
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
  const seasons = parseSeasons('--seasons', required('--seasons'));
  const draftYears = parseSeasons('--draft-years', required('--draft-years'));
  const heldOutDraftYears = parseSeasons(
    '--held-out-draft-years',
    required('--held-out-draft-years')
  );
  const last = seasons[seasons.length - 1]!;
  if (draftYears[0]! + 1 < seasons[0]! || draftYears[draftYears.length - 1]! >= last)
    throw new TypeError('--seasons must cover every season after each draft in --draft-years.');
  if (heldOutDraftYears.some((year) => !draftYears.includes(year)))
    throw new TypeError('--held-out-draft-years must be drafts in --draft-years.');
  if (draftYears.filter((year) => year < heldOutDraftYears[0]!).length < 2)
    throw new TypeError('At least two draft classes must precede the held-out classes.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    methodId: required('--method'),
    seasons,
    draftYears,
    heldOutDraftYears,
    storeId,
    out,
    dryRun,
  };
}

/** Fits on every class, back-tests with the held-out classes, and seals the result. */
export function createAflTradeValueLineFitArtifact(input: {
  model: AflTradePlayerSeasonGames;
  draftees: readonly AflTradeValueLineDraftee[];
  heldOutDraftYears: readonly number[];
}) {
  const unavailable = input.model.seasons.filter(
    ({ availability }) => availability !== 'available'
  );
  if (unavailable.length > 0)
    throw new Error(
      `Seasons ${unavailable.map(({ season }) => season).join(', ')} are not available; the fit refuses.`
    );
  if (input.model.discrepancies.length > 0)
    throw new Error(
      `${input.model.discrepancies.length} player-seasons disagree with their appearances; the fit refuses.`
    );
  const lastSeason = Math.max(...input.model.seasons.map(({ season }) => season));
  const firstHeldOut = Math.min(...input.heldOutDraftYears);
  const draftYears = input.draftees.map(({ draftYear }) => draftYear);
  const fit = fitAflTradeValueLine({
    model: input.model,
    draftees: input.draftees,
    asOfSeason: lastSeason,
  });
  const backtest = backtestAflTradeValueLine({
    model: input.model,
    draftees: input.draftees,
    trainingDraftYears: { from: Math.min(...draftYears), through: firstHeldOut - 1 },
    heldOutDraftYears: input.heldOutDraftYears,
    actualThroughSeason: lastSeason,
  });
  const content = {
    schemaVersion: AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION,
    methodId: input.model.methodId,
    calculations: input.model.seasons.map(({ season, calculationId }) => ({
      season,
      calculationId,
    })),
    rules: AFL_TRADE_VALUE_LINE_FIT_RULES,
    decisions: AFL_TRADE_VALUE_LINE_FIT_DECISIONS,
    fit,
    pickCurve: aflTradeValueLinePickCurve(fit, PICK_CURVE_THROUGH),
    backtest,
    draftees: input.draftees,
    limitation: AFL_TRADE_VALUE_LINE_FIT_LIMITATION,
    publicationEligible: false,
  };
  // Round-trip through JSON so the readonly constants seal as plain values.
  const plain = JSON.parse(JSON.stringify(content)) as typeof content;
  return { fitId: createAflTradeContentAddress('value-line-fit', plain), content: plain };
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

export async function runExportValueLineFitCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}) {
  const parsed = parseExportValueLineFitArguments(input.argv, input.env);
  await requireOutAbsent(parsed.out, 'fit');
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 1 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const model = await loadAflTradePlayerSeasonGames(client, {
      methodId: parsed.methodId,
      seasons: parsed.seasons,
    });
    const draftees = await loadAflTradeValueLineDraftees(client, parsed.draftYears);
    const artifact = createAflTradeValueLineFitArtifact({
      model,
      draftees,
      heldOutDraftYears: parsed.heldOutDraftYears,
    });
    const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(artifact));
    if (bytes.byteLength > MAXIMUM_FIT_BYTES)
      throw new RangeError(`The fit exceeds ${MAXIMUM_FIT_BYTES} bytes.`);
    const stored = parsed.dryRun ? null : await storeValueLineFit(client, parsed.storeId!, bytes);
    await writeStoredOutputFile(parsed.out, bytes, stored, 'fit');
    const { fit } = artifact.content;
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify({
        fitId: artifact.fitId,
        window: fit.window,
        k: fit.credibility.k,
        rho: fit.availability.rho,
        out: parsed.out,
        artifactId: stored?.reference.artifactId ?? null,
        dryRun: parsed.dryRun,
      })
    );
    return { ...artifact, stored };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runExportValueLineFitCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Value-line fit export stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
