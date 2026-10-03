import { Pool } from 'pg';

import { calculateAflTradeHpnPavCore } from '../src/server/aflTradeIntelligence/modeling/hpnPavCore';
import {
  aggregateLocalHpnPavCoreInput,
  describeLocalHpnPavPlayers,
} from '../src/server/aflTradeIntelligence/development/localHpnPavDirectCalculation';
import { loadLocalHpnPavSeasonRows } from '../src/server/aflTradeIntelligence/development/localHpnPavSeasonRows';

/**
 * Computes one season of HPN PAV directly from admitted AFL Tables player-match rows, using the
 * repo's own PAV core. This is a development/verification lane: it reproduces the governed
 * calculation without materializing the reviewed season universe.
 *
 * Without a run id it reads the capture's latest finalized normalization run, as the governed
 * assembler does.
 *
 * Usage: npx tsx Scripts/compute-local-hpn-pav.ts <database-url> <season> <capture-id> [normalization-run-id]
 */
const databaseUrl = process.argv[2];
const season = Number.parseInt(process.argv[3] ?? '', 10);
const captureId = process.argv[4];
const requestedRunId = process.argv[5] ?? null;
if (!databaseUrl || !Number.isInteger(season) || !captureId) {
  throw new TypeError(
    'Usage: compute-local-hpn-pav.ts <database-url> <season> <capture-id> [normalization-run-id]'
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const { normalizationRunId, rows } = await loadLocalHpnPavSeasonRows(pool, {
    season,
    captureId,
    normalizationRunId: requestedRunId,
  });
  const players = describeLocalHpnPavPlayers(rows);
  const result = calculateAflTradeHpnPavCore(aggregateLocalHpnPavCoreInput({ season, rows }));
  const ranked = [...result.players].sort((left, right) => right.totalPav - left.totalPav);
  process.stdout.write(
    `${JSON.stringify(
      {
        season,
        captureId,
        normalizationRunId,
        sourceRowCount: rows.length,
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
          playerId: player.playerId,
          names: [...(players.get(player.playerId)?.names ?? [])],
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
