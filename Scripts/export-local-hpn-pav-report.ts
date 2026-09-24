import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';

import { parseDraftguruTradeDetail } from '../src/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { calculateAflTradeHpnPavCore } from '../src/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  aggregateLocalHpnPavCoreInput,
  type LocalHpnPavDecodedRow,
} from '../src/server/aflTradeIntelligence/development/localHpnPavDirectCalculation';

/**
 * Exports the development-lane PAV grade report: two seasons of player PAV computed straight from
 * admitted AFL Tables rows, plus the 2025 trade grades (at-trade vs realized vs the comparison).
 *
 * Clearly a development artifact: no reviewed season universe, no governed registry records, no
 * publication authority. The report states that provenance itself.
 *
 * Usage: npx tsx Scripts/export-local-hpn-pav-report.ts <database-url> <archive-dir> <output.json>
 */
const [databaseUrl, archiveRoot, outputPath] = process.argv.slice(2);
if (!databaseUrl || !archiveRoot || !outputPath) {
  throw new TypeError(
    'Usage: export-local-hpn-pav-report.ts <database-url> <draftguru-full-archive-dir> <output.json>'
  );
}

const CAPTURES = {
  2024: 'source-capture:59d5d02ed2a1c035803a967745a8339b2d691437eb734f06994c24105a2c3728',
  2025: 'source-capture:694075c069bef50da49aeeab57a8515847267d62c14a72bddad68130beada9e5',
} as const;
const RUN_2025 =
  'provider-normalization-run:0c25e2fa0f561ca45f88d903ce69e328df5be9918e8e4240eea22cafed98d4ee';

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

const PAV_SELECT = `SELECT
  typed_payload->'values'->'Player'->>'value' AS "player",
  typed_payload->'values'->'Playing.for'->>'value' AS "playingFor",
  typed_payload->'values'->'Date'->>'value' AS "matchDate",
  typed_payload->'values'->'Home.team'->>'value' AS "homeTeam",
  typed_payload->'values'->'Away.team'->>'value' AS "awayTeam",
  typed_payload->'values'->'Home.score'->>'value' AS "homeScore",
  typed_payload->'values'->'Away.score'->>'value' AS "awayScore",
  typed_payload->'values'->'Goals'->>'value' AS "goals",
  typed_payload->'values'->'Behinds'->>'value' AS "behinds",
  typed_payload->'values'->'Marks'->>'value' AS "marks",
  typed_payload->'values'->'Tackles'->>'value' AS "tackles",
  typed_payload->'values'->'Hit.Outs'->>'value' AS "hitOuts",
  typed_payload->'values'->'Rebounds'->>'value' AS "rebounds",
  typed_payload->'values'->'Clearances'->>'value' AS "clearances",
  typed_payload->'values'->'Inside.50s'->>'value' AS "inside50s",
  typed_payload->'values'->'Goal.Assists'->>'value' AS "goalAssists",
  typed_payload->'values'->'Frees.For'->>'value' AS "freesFor",
  typed_payload->'values'->'Frees.Against'->>'value' AS "freesAgainst",
  typed_payload->'values'->'One.Percenters'->>'value' AS "onePercenters",
  typed_payload->'values'->'Marks.Inside.50'->>'value' AS "marksInside50"
FROM outcome_provider_decoded_row
WHERE season_year = $1
  AND capture_id = $2`;

async function loadPav(
  season: number,
  captureId: string,
  runId: string | null
): Promise<Record<string, number>> {
  const sql = runId === null ? PAV_SELECT : `${PAV_SELECT} AND row_status = 'staged' AND normalization_run_id = $3`;
  const rows = await pool.query<LocalHpnPavDecodedRow>(
    sql,
    runId === null ? [season, captureId] : [season, captureId, runId]
  );
  const teams = aggregateLocalHpnPavCoreInput({ season, rows: rows.rows });
  const result = calculateAflTradeHpnPavCore(teams);
  return Object.fromEntries(
    result.players.map((player) => [norm(player.playerId), Number(player.totalPav.toFixed(4))])
  );
}

try {
  const pav2024 = await loadPav(2024, CAPTURES[2024], null);
  const pav2025 = await loadPav(2025, CAPTURES[2025], RUN_2025);

  type Entry = { url: string; sha256: string; bodyFile: string; recordedAt: string };
  const cache = JSON.parse(readFileSync(join(archiveRoot, 'detail-cache.json'), 'utf8')) as {
    entries: Entry[];
  };
  const trades = cache.entries.filter((entry) => /\/trades\/2025-/.test(entry.url));

  const verdicts: Record<string, unknown>[] = [];
  let matchedPlayers = 0;
  let unmatchedPlayers = 0;
  for (const entry of trades) {
    const html = readFileSync(join(archiveRoot, 'detail-bodies', entry.bodyFile), 'utf8');
    const parsed = parseDraftguruTradeDetail(html, {
      capture: {
        captureId: `source-capture:${entry.sha256}`,
        artifactId: `artifact:${entry.sha256}`,
        contentSha256: entry.sha256,
        mediaType: 'text/html; charset=utf-8',
        sourceUrl: entry.url,
        capturedAt: new Date(entry.recordedAt).toISOString(),
        effectiveAt: '2025-10-01T00:00:00.000Z',
        parserVersion: 'draftguru-trade-parser/v1',
        fieldManifestSha256: '0'.repeat(64),
      },
      draftYear: 2025,
      effectiveAt: '2025-10-01T00:00:00.000Z',
    });

    const perClub = new Map<string, { atTrade: number; realized: number }>();
    for (const row of parsed.evidence) {
      const claim = row.content.claim as Record<string, unknown>;
      if (claim.kind !== 'directed_transfer') continue;
      const from = (claim.fromClub as { recordedName?: string })?.recordedName ?? '';
      const to = (claim.toClub as { recordedName?: string })?.recordedName ?? '';
      const asset = claim.asset as { kind?: string; player?: { recordedName?: string } };
      if (asset.kind !== 'player' || !asset.player?.recordedName) continue;
      const name = norm(asset.player.recordedName);
      const value = { atTrade: pav2024[name] ?? 0, realized: pav2025[name] ?? 0 };
      if (value.atTrade !== 0 || value.realized !== 0) matchedPlayers += 1;
      else unmatchedPlayers += 1;
      const fromValue = perClub.get(from) ?? { atTrade: 0, realized: 0 };
      const toValue = perClub.get(to) ?? { atTrade: 0, realized: 0 };
      fromValue.atTrade -= value.atTrade;
      fromValue.realized -= value.realized;
      toValue.atTrade += value.atTrade;
      toValue.realized += value.realized;
      perClub.set(from, fromValue);
      perClub.set(to, toValue);
    }
    if (perClub.size === 0) continue;
    const eventId = /\/trades\/([^/]+)$/.exec(entry.url)?.[1] ?? '';
    verdicts.push({
      trade: eventId,
      clubs: [...perClub.entries()].map(([club, value]) => ({
        club,
        atTradeNet: Number(value.atTrade.toFixed(2)),
        realizedNet: Number(value.realized.toFixed(2)),
        grade: Number((value.realized - value.atTrade).toFixed(2)),
      })),
    });
  }

  const report = {
    schemaVersion: 'statly-local-hpn-pav-development-report/v1',
    generatedAt: new Date().toISOString(),
    provenance: {
      lane: 'development_direct_hpn_pav',
      boundary:
        'Direct PAV over admitted AFL Tables decoded rows. No reviewed season universe, no governed registry records, no publication authority. Not a published Statly valuation.',
      captures: CAPTURES,
      run2025: RUN_2025,
    },
    tradesGraded: verdicts.length,
    matchedPlayerLegs: matchedPlayers,
    unmatchedPlayerLegs: unmatchedPlayers,
    verdicts,
  };
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      wroteTo: outputPath,
      tradesGraded: verdicts.length,
      matchedPlayerLegs: matchedPlayers,
      unmatchedPlayerLegs: unmatchedPlayers,
      pav2024Players: Object.keys(pav2024).length,
      pav2025Players: Object.keys(pav2025).length,
    })}\n`
  );
} finally {
  await pool.end();
}
