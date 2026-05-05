#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import {
  publishLeagueRosterSummaries,
  publishPlayerRankings,
  refreshPlayerReadModels,
} from '../src/server/readModels/playerReadModels';

function parseArgs(argv: string[]) {
  const readArgValue = (name: string): string | undefined => {
    const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
    if (equalsValue != null) return equalsValue;
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const seasonArg = readArgValue('--season');
  const roundsArg = readArgValue('--rounds');
  const playerIdsArg = readArgValue('--playerIds') ?? readArgValue('--player-ids');
  const leagueId = readArgValue('--leagueId') ?? readArgValue('--league-id');
  const scope = readArgValue('--scope') ?? 'season';
  const mode = readArgValue('--mode') ?? 'full';

  return {
    season: seasonArg ? Number(seasonArg) : undefined,
    rounds: roundsArg
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0),
    playerIds: playerIdsArg
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    leagueId,
    scope,
    mode,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  let result: Record<string, unknown>;

  if (args.mode === 'refresh') {
    result = await refreshPlayerReadModels({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
      rounds: args.rounds,
      playerIds: args.playerIds,
    }) as unknown as Record<string, unknown>;
  } else if (args.mode === 'rankings') {
    result = await publishPlayerRankings({
      season: args.season,
      scope: args.scope,
    }) as unknown as Record<string, unknown>;
  } else if (args.mode === 'rosters') {
    result = await publishLeagueRosterSummaries({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
    }) as unknown as Record<string, unknown>;
  } else {
    const refreshResult = await refreshPlayerReadModels({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
      rounds: args.rounds,
      playerIds: args.playerIds,
    });
    const rankingResult = await publishPlayerRankings({
      season: args.season,
      scope: args.scope,
    });
    const rosterResult = await publishLeagueRosterSummaries({
      season: args.season,
      scope: args.scope,
      leagueId: args.leagueId,
    });
    result = {
      refreshResult,
      rankingResult,
      rosterResult,
    };
  }

  const elapsedMs = Date.now() - startedAt;
  const verifierCommand = `npm run verify:player-read-models -- --season ${
    args.season ?? '<season>'
  }${args.rounds?.length ? ` --rounds ${args.rounds.join(',')}` : ''} --json`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.mode,
        elapsedMs,
        audit: {
          season: args.season ?? null,
          rounds: args.rounds ?? [],
          playerIds: args.playerIds ?? [],
          leagueId: args.leagueId ?? null,
          verifierCommand,
        },
        ...result,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
