#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { refreshPlayerReadModels } from '../src/server/readModels/playerReadModels';

function parseArgs(argv: string[]) {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const leagueId = argv.find((arg) => arg.startsWith('--leagueId='))?.split('=')[1];
  const scope = argv.find((arg) => arg.startsWith('--scope='))?.split('=')[1] ?? 'season';

  return {
    season: seasonArg ? Number(seasonArg) : undefined,
    leagueId,
    scope,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const result = await refreshPlayerReadModels({
    season: args.season,
    scope: args.scope,
    leagueId: args.leagueId,
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedMs,
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
