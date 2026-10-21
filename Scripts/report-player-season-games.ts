import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadAflTradePlayerSeasonGames } from '../src/server/aflTradeIntelligence/modeling/postgresPlayerSeasonGames';
import type { AflTradePlayerSeasonGames } from '../src/server/aflTradeIntelligence/modeling/playerSeasonGames';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { parseSeasons } from './gradingArguments';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Reports games and PAV coverage per season from the player-season games read model (#789), read-only.
 * It prints one JSON line: per season its availability, calculation, rows, players, games and PAV,
 * and every discrepancy between a calculation's games and its factual appearances. Nothing is written.
 *
 * Usage:
 *   AFL_OUTCOMES_DATABASE_URL=<loopback url> npm run outcomes:grading:season-games -- \
 *     --method <hpn-pav-method:...> --seasons 2011-2026
 */

export interface PlayerSeasonGamesReport {
  methodId: string;
  seasons: {
    season: number;
    availability: string;
    calculationId: string | null;
    rows: number;
    players: number;
    games: number;
    pav: number;
    pavWithoutAppearances: number;
    appearancesWithoutPav: number;
    gameCountMismatches: number;
  }[];
  discrepancies: AflTradePlayerSeasonGames['discrepancies'];
}

export function summarizePlayerSeasonGames(
  model: AflTradePlayerSeasonGames
): PlayerSeasonGamesReport {
  return {
    methodId: model.methodId,
    seasons: model.seasons.map(({ season, availability, calculationId }) => {
      const rows = model.rows.filter((row) => row.season === season);
      const discrepancies = model.discrepancies.filter((row) => row.season === season);
      return {
        season,
        availability,
        calculationId,
        rows: rows.length,
        players: new Set(rows.map(({ playerId }) => playerId)).size,
        games: rows.reduce((sum, { games }) => sum + games, 0),
        pav: Math.round(rows.reduce((sum, { pav }) => sum + pav, 0) * 1000) / 1000,
        pavWithoutAppearances: discrepancies.filter((row) => row.factualMatches === null).length,
        appearancesWithoutPav: discrepancies.filter((row) => row.games === null).length,
        gameCountMismatches: discrepancies.filter(
          (row) => row.games !== null && row.factualMatches !== null
        ).length,
      };
    }),
    discrepancies: model.discrepancies,
  };
}

export function parseReportPlayerSeasonGamesArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];
    if (name !== '--method' && name !== '--seasons')
      throw new TypeError(`Unexpected argument ${name}.`);
    if (value === undefined || value.startsWith('--'))
      throw new TypeError(`${name} needs a value.`);
    if (values.has(name)) throw new TypeError(`${name} may be given once.`);
    values.set(name, value);
  }
  const method = values.get('--method');
  const seasons = values.get('--seasons');
  if (method === undefined) throw new TypeError('--method is required.');
  if (seasons === undefined) throw new TypeError('--seasons is required.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    methodId: method,
    seasons: parseSeasons('--seasons', seasons),
  };
}

export async function runReportPlayerSeasonGamesCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<PlayerSeasonGamesReport> {
  const parsed = parseReportPlayerSeasonGamesArguments(input.argv, input.env);
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 1 });
  try {
    const model = await loadAflTradePlayerSeasonGames(createPgAflOutcomeSqlClient(pool), {
      methodId: parsed.methodId,
      seasons: parsed.seasons,
    });
    const report = summarizePlayerSeasonGames(model);
    (input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`)))(
      JSON.stringify(report)
    );
    return report;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runReportPlayerSeasonGamesCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Season games report stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
