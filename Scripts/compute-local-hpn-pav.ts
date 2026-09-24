import { Pool } from 'pg';

import { calculateAflTradeHpnPavCore } from '../src/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  aggregateLocalHpnPavCoreInput,
  type LocalHpnPavDecodedRow,
} from '../src/server/aflTradeIntelligence/development/localHpnPavDirectCalculation';

/**
 * Computes one season of HPN PAV directly from admitted AFL Tables player-match rows, using the
 * repo's own PAV core. This is a development/verification lane: it reproduces the governed
 * calculation without materializing the reviewed season universe.
 *
 * Usage: npx tsx Scripts/compute-local-hpn-pav.ts <database-url> <season> <capture-id> [normalization-run-id]
 */
const databaseUrl = process.argv[2];
const season = Number.parseInt(process.argv[3] ?? '', 10);
const captureId = process.argv[4];
const runId = process.argv[5] ?? null;
if (!databaseUrl || !Number.isInteger(season) || !captureId) {
  throw new TypeError(
    'Usage: compute-local-hpn-pav.ts <database-url> <season> <capture-id> [normalization-run-id]'
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const rows = await pool.query<LocalHpnPavDecodedRow>(
    `SELECT
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
       AND capture_id = $2
       ${runId !== null ? "AND row_status = 'staged' AND normalization_run_id = $3" : ''}`,
    runId !== null ? [season, captureId, runId] : [season, captureId]
  );

  const teams = aggregateLocalHpnPavCoreInput({ season, rows: rows.rows });
  const result = calculateAflTradeHpnPavCore(teams);
  const ranked = [...result.players].sort((left, right) => right.totalPav - left.totalPav);
  process.stdout.write(
    `${JSON.stringify(
      {
        season,
        captureId,
        normalizationRunId: runId,
        sourceRowCount: rows.rowCount,
        league: result.league,
        teams: result.teams
          .map(({ teamId, totalPav, offensivePav, midfieldPav, defensivePav }) => ({
            teamId,
            totalPav,
            offensivePav,
            midfieldPav,
            defensivePav,
          }))
          .sort((left, right) => right.totalPav - left.totalPav),
        topPlayers: ranked.slice(0, 25).map((player) => ({
          player: player.playerId,
          team: player.teamId,
          totalPav: player.totalPav,
          offensivePav: player.offensivePav,
          midfieldPav: player.midfieldPav,
          defensivePav: player.defensivePav,
        })),
        playerCount: ranked.length,
      },
      null,
      1
    )}\n`
  );
} finally {
  await pool.end();
}
