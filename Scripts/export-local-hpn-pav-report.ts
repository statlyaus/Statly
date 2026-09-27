import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Pool } from 'pg';

import { parseDraftguruTradeDetail } from '../src/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { calculateAflTradeHpnPavCore } from '../src/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  aggregateLocalHpnPavCoreInput,
  describeLocalHpnPavPlayers,
} from '../src/server/aflTradeIntelligence/development/localHpnPavDirectCalculation';
import { loadLocalHpnPavSeasonRows } from '../src/server/aflTradeIntelligence/development/localHpnPavSeasonRows';
import {
  gradeLocalHpnPavTrade,
  type LocalHpnPavSeasonView,
} from '../src/server/aflTradeIntelligence/development/localHpnPavTradeGrading';

/**
 * Exports the development-lane PAV report for the trades of one trade period.
 *
 * A trade in year Y happens after season Y, so the at-trade view is season Y and the realized view is
 * season Y + 1 at the receiving club. Without a Y + 1 capture the report carries at-trade values only
 * and grades nothing. Trades with picks, unresolved players or parse issues are reported as incomplete
 * rather than graded.
 *
 * Clearly a development artifact: no reviewed season universe, no governed registry records, no
 * publication authority. The report states that provenance itself.
 *
 * Usage: npx tsx Scripts/export-local-hpn-pav-report.ts <database-url> <draftguru-full-archive-dir> <output.json>
 *   --trade-year <Y> --at-trade-capture <capture-id> [--at-trade-run <run-id>]
 *   [--realized-capture <capture-id> [--realized-run <run-id>]]
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'trade-year': { type: 'string' },
    'at-trade-capture': { type: 'string' },
    'at-trade-run': { type: 'string' },
    'realized-capture': { type: 'string' },
    'realized-run': { type: 'string' },
  },
});
const [databaseUrl, archiveRoot, outputPath] = positionals;
const tradeYear = Number.parseInt(values['trade-year'] ?? '', 10);
const atTradeCapture = values['at-trade-capture'];
if (
  !databaseUrl ||
  !archiveRoot ||
  !outputPath ||
  !Number.isInteger(tradeYear) ||
  !atTradeCapture
) {
  throw new TypeError(
    'Usage: export-local-hpn-pav-report.ts <database-url> <archive-dir> <output.json> --trade-year <Y> --at-trade-capture <id> [--at-trade-run <id>] [--realized-capture <id> [--realized-run <id>]]'
  );
}
if (values['realized-run'] !== undefined && values['realized-capture'] === undefined) {
  throw new TypeError('--realized-run requires --realized-capture.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function loadSeason(season: number, captureId: string, runId: string | undefined) {
  const { normalizationRunId, rows } = await loadLocalHpnPavSeasonRows(pool, {
    season,
    captureId,
    normalizationRunId: runId ?? null,
  });
  const result = calculateAflTradeHpnPavCore(aggregateLocalHpnPavCoreInput({ season, rows }));
  const view: LocalHpnPavSeasonView = {
    pav: new Map(result.players.map((player) => [player.playerId, player.totalPav])),
    players: describeLocalHpnPavPlayers(rows),
  };
  return { season, captureId, normalizationRunId, playerCount: result.players.length, view };
}

try {
  const atTrade = await loadSeason(tradeYear, atTradeCapture, values['at-trade-run']);
  const realized =
    values['realized-capture'] === undefined
      ? null
      : await loadSeason(tradeYear + 1, values['realized-capture'], values['realized-run']);

  type Entry = { url: string; sha256: string; bodyFile: string; recordedAt: string };
  const cache = JSON.parse(readFileSync(join(archiveRoot, 'detail-cache.json'), 'utf8')) as {
    entries: Entry[];
  };
  const trades = cache.entries.filter((entry) => entry.url.includes(`/trades/${tradeYear}-`));
  // A parser argument only: the source records no trade date, and none is inferred from it.
  const nominalInstant = `${tradeYear}-10-01T00:00:00.000Z`;

  const verdicts = trades.map((entry) => {
    const html = readFileSync(join(archiveRoot, 'detail-bodies', entry.bodyFile), 'utf8');
    const parsed = parseDraftguruTradeDetail(html, {
      capture: {
        captureId: `source-capture:${entry.sha256}`,
        artifactId: `artifact:${entry.sha256}`,
        contentSha256: entry.sha256,
        mediaType: 'text/html; charset=utf-8',
        sourceUrl: entry.url,
        capturedAt: new Date(entry.recordedAt).toISOString(),
        effectiveAt: nominalInstant,
        parserVersion: 'draftguru-trade-parser/v1',
        fieldManifestSha256: '0'.repeat(64),
      },
      draftYear: tradeYear,
      effectiveAt: nominalInstant,
    });
    const legs = parsed.evidence.flatMap(({ content: { claim } }) =>
      claim.kind === 'directed_transfer'
        ? [
            {
              fromClub: claim.fromClub.recordedName,
              toClub: claim.toClub.recordedName,
              assetKind: claim.asset.kind,
              playerName: claim.asset.kind === 'player' ? claim.asset.player.recordedName : null,
            },
          ]
        : []
    );
    return gradeLocalHpnPavTrade({
      tradeId: /\/trades\/([^/]+)$/.exec(entry.url)?.[1] ?? entry.url,
      legs,
      parseIssues: parsed.issues.map(({ code }) => code),
      atTrade: atTrade.view,
      realized: realized?.view ?? null,
    });
  });

  const describeSeason = (season: typeof atTrade | null) =>
    season === null
      ? null
      : {
          season: season.season,
          captureId: season.captureId,
          normalizationRunId: season.normalizationRunId,
          playerCount: season.playerCount,
        };
  const summary = {
    tradeYear,
    tradesFound: trades.length,
    complete: verdicts.filter(({ status }) => status === 'complete').length,
    incomplete: verdicts.filter(({ status }) => status === 'incomplete').length,
    graded: verdicts.filter(({ clubs }) => clubs.some(({ grade }) => grade !== null)).length,
  };
  const report = {
    schemaVersion: 'statly-local-hpn-pav-development-report/v2',
    generatedAt: new Date().toISOString(),
    provenance: {
      lane: 'development_direct_hpn_pav',
      boundary:
        'Direct PAV over admitted AFL Tables decoded rows. No reviewed season universe, no governed registry records, no publication authority. Not a published Statly valuation.',
      method: `At-trade value is season ${tradeYear}; realized value is season ${tradeYear + 1} at the receiving club. Picks are not valued, so trades containing them are incomplete.`,
      atTrade: describeSeason(atTrade),
      realized: describeSeason(realized),
    },
    ...summary,
    verdicts,
  };
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ wroteTo: outputPath, ...summary })}\n`);
} finally {
  await pool.end();
}
